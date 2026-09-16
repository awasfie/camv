import { EgressClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { verifyHostProof } from '@/lib/hostProof';
import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

/**
 * GET /api/record/status?roomName=...
 *
 * Returns whether a room currently has an active (non-terminal) Egress recording.
 * Useful for the call UI to reflect recording state on load / reconnect, since
 * `useIsRecording()` from @livekit/components-react only reflects the LiveKit
 * Room's live `isRecording` flag while connected.
 *
 * Gated by the same host-proof as /start and /stop (RA-T2, Bible v11.5):
 * previously anyone who could guess/know a roomName could probe whether it
 * was being recorded. This endpoint currently has no caller in the client
 * (dead code) -- gating it now, before it's ever wired up, closes the gap
 * for good rather than leaving an easy-to-forget TODO.
 */
export async function GET(req: NextRequest) {
  try {
    const limit = await checkRateLimit(`record-status:${clientIp(req.headers)}`, 30, 60);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many status checks, try again shortly.' },
        { status: 429, headers: rateLimitHeaders(limit) },
      );
    }

    const roomName = req.nextUrl.searchParams.get('roomName');
    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 400 });
    }

    const proof = req.headers.get('x-camv-host-proof');
    if (!proof || !verifyHostProof(roomName, proof)) {
      return NextResponse.json(
        { error: 'forbidden', message: 'Only the meeting host can check recording status' },
        { status: 403 },
      );
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
