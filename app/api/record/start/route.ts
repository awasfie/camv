import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { verifyHostProof } from '@/lib/hostProof';
import { getDb } from '@/lib/db';
import { checkCaptureGate, enforcePublishGate } from '@/lib/consent/gate';
import { liveKitOps } from '@/lib/consent/livekit';
import { deleteAfter } from '@/lib/consent/policy';
import { insertRecording } from '@/lib/consent/repo';
import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  try {
    // RA-T3 (Bible v11.5): recording start is a costly/abusable action
    // (spins up an Egress job) -- limit per-IP regardless of hostProof
    // validity, so a leaked/guessed proof can't be used to spam-start.
    const limit = await checkRateLimit(`record-start:${clientIp(req.headers)}`, 10, 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many recording requests, try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const roomName = req.nextUrl.searchParams.get('roomName');

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    // Recording used to be startable by anyone who knew a roomName (the
    // template's original CAUTION comment said as much). Ahmed:
    // "it should [not] be that anyone [can] stop and start the
    // recording" -- only the participant Camv identified as this
    // meeting's host (via Timeway's booking record) gets a hostProof
    // token at join time; verify it here rather than trusting the UI to
    // hide the button, since the endpoint itself is reachable directly.
    const hostProof = req.nextUrl.searchParams.get('hostProof');
    if (!verifyHostProof(roomName, hostProof)) {
      return new NextResponse('Only the meeting host can start a recording', { status: 403 });
    }

    const {
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      LIVEKIT_URL,
      RECORDING_S3_ACCESS_KEY,
      RECORDING_S3_SECRET_KEY,
      RECORDING_S3_BUCKET,
      RECORDING_S3_ENDPOINT,
      RECORDING_S3_REGION,
    } = process.env;

    if (
      !RECORDING_S3_BUCKET ||
      !RECORDING_S3_ENDPOINT ||
      !RECORDING_S3_ACCESS_KEY ||
      !RECORDING_S3_SECRET_KEY
    ) {
      return new NextResponse(
        'Recording storage is not configured on this deployment. Set RECORDING_S3_BUCKET, ' +
          'RECORDING_S3_ENDPOINT, RECORDING_S3_ACCESS_KEY and RECORDING_S3_SECRET_KEY, then redeploy.',
        { status: 501 },
      );
    }

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const existingEgresses = await egressClient.listEgress({ roomName });
    if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
      return new NextResponse('Meeting is already being recorded', { status: 409 });
    }

    // WC-CV-3 / CC-70: refuse (409) until every present participant has agreed;
    // 403 when the org may not record (no workspace, Free plan, Egypt under
    // R3-30 (b), or turned off); 503 when the consent store is not configured.
    const db = getDb();
    const lk = liveKitOps();
    const gate = await checkCaptureGate(db, lk, roomName);
    if (!gate.ok) {
      return NextResponse.json(gate.body, { status: gate.status });
    }

    const startedAt = new Date();
    const objectKey = `${startedAt.toISOString()}-${roomName}.mp4`;
    const fileOutput = new EncodedFileOutput({
      filepath: objectKey,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint: RECORDING_S3_ENDPOINT,
          accessKey: RECORDING_S3_ACCESS_KEY,
          secret: RECORDING_S3_SECRET_KEY,
          region: RECORDING_S3_REGION,
          bucket: RECORDING_S3_BUCKET,
          forcePathStyle: true,
        }),
      },
    });

    const info = await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file: fileOutput,
      },
      {
        layout: 'speaker',
      },
    );

    // Register the recording for the retention job BEFORE reporting success: a
    // recording the job does not know about would never be deleted, so if the
    // insert fails the egress is stopped and the start is reported as failed.
    try {
      await insertRecording(db!, {
        roomId: roomName,
        orgId: gate.org.id,
        egressId: info.egressId,
        bucket: RECORDING_S3_BUCKET,
        objectKey,
        startedAt,
        retentionDays: gate.retentionDays,
        deleteAfter: deleteAfter(startedAt, gate.retentionDays),
        consentSnapshot: gate.consented,
      });
    } catch (e) {
      await egressClient.stopEgress(info.egressId).catch(() => undefined);
      throw e;
    }

    // Close the race between the gate check and the egress start: anyone who
    // joined in between and has not agreed loses publish permission now.
    await enforcePublishGate(db!, lk, roomName, true).catch((e) =>
      console.error('publish gate after start failed', e instanceof Error ? e.message : e),
    );

    return NextResponse.json({ egressId: info.egressId, retentionDays: gate.retentionDays });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
