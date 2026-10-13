import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { CONSENT_TEXT_VERSION } from '@/lib/consent/copy';
import { liveKitOps } from '@/lib/consent/livekit';
import {
  CONSENT_PURPOSE,
  isConsentDecision,
  isConsentLocale,
  mayPublishAfterDecision,
} from '@/lib/consent/policy';
import { getRoomOrg, insertConsentEvent } from '@/lib/consent/repo';
import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

/**
 * POST /api/consent — WC-CV-3 step 1. The participant answers the join banner.
 *
 * Auth: the participant's own LiveKit token (Authorization: Bearer <token>), so
 * identity and room come from a signature, never from the body. Body:
 * { decision: 'granted' | 'declined', locale: 'en' | 'ar' }.
 *
 * Persists one consent_events row {roomId, participantId, identity, ts, purpose,
 * locale} and sets the participant's publish permission: granted → may publish;
 * declined → may publish only while nothing is being captured.
 */
export async function POST(req: NextRequest) {
  const limit = await checkRateLimit(`consent:${clientIp(req.headers)}`, 30, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many requests, try again shortly.' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const lk = liveKitOps();
  const who = token ? await lk.verifyParticipantToken(token) : null;
  if (!who) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { decision, locale } = (body ?? {}) as { decision?: unknown; locale?: unknown };
  if (!isConsentDecision(decision) || !isConsentLocale(locale)) {
    return NextResponse.json(
      {
        error: 'invalid_body',
        message: "decision must be 'granted' or 'declined'; locale 'en' or 'ar'",
      },
      { status: 400 },
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'consent_store_unavailable' }, { status: 503 });
  }

  try {
    const org = await getRoomOrg(db, who.room);
    if (!org) {
      return NextResponse.json({ error: 'room_not_consent_gated' }, { status: 409 });
    }
    const participant = await lk.getParticipant(who.room, who.identity);
    if (!participant) {
      return NextResponse.json(
        { error: 'not_in_room', message: 'Join the meeting before answering.' },
        { status: 409 },
      );
    }

    const saved = await insertConsentEvent(db, {
      roomId: who.room,
      participantId: participant.sid,
      identity: who.identity,
      participantName: participant.name || who.name,
      orgId: org.id,
      country: org.country ?? 'ZZ',
      purpose: CONSENT_PURPOSE,
      decision,
      locale,
      textVersion: CONSENT_TEXT_VERSION,
    });

    const captureActive = await lk.captureActive(who.room);
    const canPublish = mayPublishAfterDecision(decision, captureActive);
    if (canPublish !== participant.canPublish) {
      await lk.setCanPublish(who.room, who.identity, canPublish);
    }

    return NextResponse.json({
      consentEventId: saved.id,
      ts: saved.ts,
      decision,
      canPublish,
      captureActive,
    });
  } catch (e) {
    console.error('consent POST failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
