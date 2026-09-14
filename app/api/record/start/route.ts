import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');

    /**
     * CAUTION:
     * for simplicity this implementation does not authenticate users and therefore allows anyone with knowledge of a roomName
     * to start/stop recordings for that room.
     * DO NOT USE THIS FOR PRODUCTION PURPOSES AS IS
     */

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
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
