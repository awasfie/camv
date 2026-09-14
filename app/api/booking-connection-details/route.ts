import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { randomString } from '@/lib/client-utils';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { ConnectionDetails } from '@/lib/types';

/**
 * Booking-aware token endpoint — TW-T7 per Execution Bible v11.1.
 *
 * Unlike the stock /api/connection-details route (which mints a token for
 * ANY roomName+participantName with no validation), this endpoint requires
 * a Timeway booking uid and validates the booking is real and not
 * cancelled/rejected via Timeway's internal booking-window API, and only
 * then issues a LiveKit token scoped to the room tw-<bookingUid>.
 *
 * Per Ahmed (2026-09-14): the link is intentionally joinable at ANY time
 * once the booking exists (not just within a tight window around the
 * scheduled slot) -- people legitimately join early, or the meeting time
 * gets changed over the phone without the booking record being updated
 * first. The security property we actually care about is "only a real,
 * still-active booking can be joined" (random/guessed room names are
 * rejected), not "only within N minutes of the original slot". If you
 * need to re-add a time restriction later, do it as an explicit,
 * generous policy decision -- not a silent default.
 *
 * Room naming convention (tw-<bookingUid>) MUST match
 * packages/app-store/livekitvideo/lib/VideoApiAdapter.ts in the timeway repo.
 */

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const TIMEWAY_BASE_URL = process.env.TIMEWAY_BASE_URL || 'https://timeway.co';
const CAMV_INTERNAL_SECRET = process.env.CAMV_INTERNAL_SECRET;

const COOKIE_KEY = 'random-participant-postfix';

type BookingWindow = {
  uid: string;
  title: string;
  startTime: string;
  endTime: string;
  status: string;
  host: { name: string | null; email: string } | null;
  attendees: { name: string | null; email: string }[];
};

async function fetchBookingWindow(bookingUid: string): Promise<BookingWindow | null> {
  if (!CAMV_INTERNAL_SECRET) {
    throw new Error('CAMV_INTERNAL_SECRET is not configured');
  }
  const res = await fetch(`${TIMEWAY_BASE_URL}/api/camv/booking-window/${bookingUid}`, {
    headers: { 'x-camv-internal-secret': CAMV_INTERNAL_SECRET },
    // Never cache booking state — status can change (reschedule, cancel).
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`booking-window lookup failed: HTTP ${res.status}`);
  }
  return (await res.json()) as BookingWindow;
}

export async function GET(request: NextRequest) {
  try {
    const roomName = request.nextUrl.searchParams.get('roomName');
    const participantName = request.nextUrl.searchParams.get('participantName');
    const metadata = request.nextUrl.searchParams.get('metadata') ?? '';
    const region = request.nextUrl.searchParams.get('region');

    if (!LIVEKIT_URL) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (!roomName) {
      return new NextResponse('Missing required query parameter: roomName', { status: 400 });
    }
    if (!participantName) {
      return new NextResponse('Missing required query parameter: participantName', { status: 400 });
    }
    if (!roomName.startsWith('tw-')) {
      return new NextResponse('Unrecognized room name format', { status: 400 });
    }
    const bookingUid = roomName.slice('tw-'.length);

    const booking = await fetchBookingWindow(bookingUid);
    if (!booking) {
      return new NextResponse('Booking not found', { status: 404 });
    }
    if (booking.status === 'CANCELLED' || booking.status === 'REJECTED') {
      return new NextResponse('This booking has been cancelled', { status: 403 });
    }

    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;

    let randomParticipantPostfix = request.cookies.get(COOKIE_KEY)?.value;
    if (!randomParticipantPostfix) {
      randomParticipantPostfix = randomString(4);
    }

    const participantToken = await createParticipantToken(
      {
        identity: `${participantName}__${randomParticipantPostfix}`,
        name: participantName,
        metadata,
      },
      roomName,
    );

    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName,
      participantToken,
      participantName,
    };
    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_KEY}=${randomParticipantPostfix}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
    return new NextResponse('Unknown error', { status: 500 });
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = '2h';
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}

function getCookieExpirationTime(): string {
  const now = new Date();
  const time = now.getTime();
  const expireTime = time + 60 * 120 * 1000;
  now.setTime(expireTime);
  return now.toUTCString();
}
