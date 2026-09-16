import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { randomString } from '@/lib/client-utils';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { mintHostProof } from '@/lib/hostProof';
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
 * Per Ahmed (2026-09-14): the link is intentionally joinable well beyond a
 * tight window around the scheduled slot (not just N minutes before/after) --
 * people legitimately join early, or the meeting time gets changed over the
 * phone without the booking record being updated first. The security
 * property we care about is "only a real, still-active booking can be
 * joined" (random/guessed room names are rejected).
 *
 * Per Bible v11.5 D-R25 (2026-09-15): that window is NOT unbounded --
 * it closes at scheduled_end + 24h, so a stale/leaked link eventually dies
 * on its own instead of remaining joinable forever. See the endTime check
 * below (410 past the window).
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

    // D-R25 (Bible v11.5): joinable from booking creation until
    // scheduled_end + 24h, not indefinitely. A leaked/old link should die
    // on its own instead of remaining joinable forever. Reschedules move
    // the window automatically since we always read the live endTime from
    // Timeway (never cached -- see fetchBookingWindow's cache: 'no-store').
    const endTimeMs = Date.parse(booking.endTime);
    if (!Number.isNaN(endTimeMs)) {
      const windowCloseMs = endTimeMs + 24 * 60 * 60 * 1000;
      if (Date.now() > windowCloseMs) {
        return NextResponse.json(
          {
            error: 'meeting_ended',
            message: 'This meeting has ended and the room is no longer joinable.',
            endedAt: booking.endTime,
          },
          { status: 410 },
        );
      }
    }

    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;

    // Determine host status by matching the joining participant's name
    // (Timeway passes the booking attendee/host's real name at join time)
    // against the booking's host name/email as recorded by Timeway. This
    // is a name-match, not a login -- Camv has no account system -- so
    // it's a reasonable-effort match rather than a cryptographic identity
    // check; combined with the room already requiring a real, active
    // booking uid, it's a meaningful improvement over "anyone in the room
    // can record" without requiring a whole auth system.
    const normalizedParticipant = participantName.trim().toLowerCase();
    const isHost =
      !!booking.host &&
      ((booking.host.name && booking.host.name.trim().toLowerCase() === normalizedParticipant) ||
        booking.host.email.trim().toLowerCase() === normalizedParticipant);

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
      isHost,
      hostProof: isHost ? mintHostProof(roomName) : undefined,
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
