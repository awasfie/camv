import { EgressClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/record/status?roomName=...
 *
 * Returns whether a room currently has an active (non-terminal) Egress recording.
 * Useful for the call UI to reflect recording state on load / reconnect, since
 * `useIsRecording()` from @livekit/components-react only reflects the LiveKit
 * Room's live `isRecording` flag while connected.
 *
 * CAUTION: same lack of auth as /start and /stop -- do not use as-is in production.
 */
export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');
    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const activeEgresses = (await egressClient.listEgress({ roomName })).filter(
      (info) => info.status < 2,
    );

    return NextResponse.json({ recording: activeEgresses.length > 0 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
