import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signed "host proof" so the recording start/stop endpoint can verify a
 * request actually came from the meeting's host, without Camv needing any
 * user accounts/sessions of its own.
 *
 * Recording used to be startable/stoppable by ANYONE who knew a room name
 * (flagged in the original template code, and directly called out by
 * Ahmed: "it should [not] be that anyone [can] stop and start the
 * recording"). Camv has no auth system, but it does already know -- from
 * Timeway's booking-window lookup -- who the booking's host is. This
 * mints a short-lived HMAC token scoped to one roomName, handed only to
 * the participant whose name/email matched the booking host, and the
 * record start/stop route verifies it before acting. Hiding the button
 * client-side alone isn't real security (anyone can call the API
 * directly), so both the UI gate AND this server-side check exist.
 */

const PROOF_TTL_MS = 4 * 60 * 60 * 1000; // matches the 2h room-join token TTL with headroom

function getSecret(): string {
  const secret = process.env.CAMV_INTERNAL_SECRET;
  if (!secret) {
    throw new Error('CAMV_INTERNAL_SECRET is not configured');
  }
  return secret;
}

export function mintHostProof(roomName: string): string {
  const expiresAt = Date.now() + PROOF_TTL_MS;
  const payload = `${roomName}.${expiresAt}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${expiresAt}.${sig}`;
}

export function verifyHostProof(roomName: string, proof: string | null): boolean {
  if (!proof) return false;
  const [expiresAtStr, sig] = proof.split('.');
  if (!expiresAtStr || !sig) return false;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const payload = `${roomName}.${expiresAt}`;
  const expectedSig = createHmac('sha256', getSecret()).update(payload).digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
