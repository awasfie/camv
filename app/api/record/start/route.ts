import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { verifyHostProof } from '@/lib/hostProof';
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

    const fileOutput = new EncodedFileOutput({
      filepath: `${new Date(Date.now()).toISOString()}-${roomName}.mp4`,
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

    await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file: fileOutput,
      },
      {
        layout: 'speaker',
      },
    );

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
