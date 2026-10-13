import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { liveKitOps } from '@/lib/consent/livekit';
import { CONSENT_PURPOSE } from '@/lib/consent/policy';
import { getRoomOrg, latestDecisions } from '@/lib/consent/repo';
import { verifyHostProof } from '@/lib/hostProof';
import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

/**
 * GET /api/consent/roster?roomName=... — WC-CV-3 step 2 host roster.
 * Host only (x-camv-host-proof). For each present participant: their latest
 * consent decision (or pending), when, in which language, and whether they may
 * publish; plus whether a recording is running.
 */
export async function GET(req: NextRequest) {
  const limit = await checkRateLimit(`consent-roster:${clientIp(req.headers)}`, 60, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }
  const roomName = req.nextUrl.searchParams.get('roomName');
  if (!roomName) return NextResponse.json({ error: 'missing_roomName' }, { status: 400 });
  // Same host-proof convention as /api/record/*: query param (header also accepted).
  const proof = req.nextUrl.searchParams.get('hostProof') ?? req.headers.get('x-camv-host-proof');
  if (!verifyHostProof(roomName, proof)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'consent_store_unavailable' }, { status: 503 });

  try {
    const lk = liveKitOps();
    const [org, present, latest, recording] = await Promise.all([
      getRoomOrg(db, roomName),
      lk.presentParticipants(roomName),
      latestDecisions(db, roomName, CONSENT_PURPOSE),
      lk.captureActive(roomName),
    ]);
    const byIdentity = new Map(latest.map((d) => [d.identity, d]));
    const participants = present.map((p) => {
      const d = byIdentity.get(p.identity);
      return {
        identity: p.identity,
        name: p.name ?? null,
        consent: d ? d.decision : 'pending',
        consentAt: d ? d.ts : null,
        locale: d ? d.locale : null,
        canPublish: p.canPublish,
      };
    });
    return NextResponse.json({
      roomName,
      gated: !!org,
      recording,
      allConsented: participants.length > 0 && participants.every((p) => p.consent === 'granted'),
      participants,
    });
  } catch (e) {
    console.error('consent roster failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
