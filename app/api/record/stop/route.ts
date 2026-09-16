import { EgressClient } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { verifyHostProof } from '@/lib/hostProof';
import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  try {
    const limit = await checkRateLimit(`record-stop:${clientIp(req.headers)}`, 20, 60);
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

    const hostProof = req.nextUrl.searchParams.get('hostProof');
    if (!verifyHostProof(roomName, hostProof)) {
      return new NextResponse('Only the meeting host can stop a recording', { status: 403 });
    }

    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    const activeEgresses = (await egressClient.listEgress({ roomName })).filter(
      (info) => info.status < 2,
    );
    if (activeEgresses.length === 0) {
      return new NextResponse('No active recording found', { status: 404 });
    }
    await Promise.all(activeEgresses.map((info) => egressClient.stopEgress(info.egressId)));

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
