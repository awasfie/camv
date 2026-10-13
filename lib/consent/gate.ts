/**
 * WC-CV-3 / CC-70: the one gate every capture path (recording now, WC-CV-6
 * transcription next) calls before it starts.
 */
import type { Queryable } from '../db';
import type { LiveKitOps } from './livekit';
import {
  CONSENT_PURPOSE,
  POLICY_MESSAGES,
  evaluateConsentGate,
  mayPublishAfterDecision,
  recordingPolicy,
  type CamvOrg,
  type PresentParticipant,
} from './policy';
import { getRoomOrg, latestDecisions } from './repo';

export type CaptureGateResult =
  | { ok: true; org: CamvOrg; retentionDays: number; consented: string[] }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function checkCaptureGate(
  db: Queryable | null,
  lk: LiveKitOps,
  roomName: string,
): Promise<CaptureGateResult> {
  if (!db) {
    return {
      ok: false,
      status: 503,
      body: {
        error: 'consent_store_unavailable',
        message: 'Recording is unavailable: the consent record store is not configured.',
      },
    };
  }
  const org = await getRoomOrg(db, roomName);
  const policy = recordingPolicy(org);
  if (!policy.allowed) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'recording_not_allowed',
        reason: policy.reason,
        message: POLICY_MESSAGES[policy.reason],
      },
    };
  }
  const present = await lk.presentParticipants(roomName);
  const latest = await latestDecisions(db, roomName, CONSENT_PURPOSE);
  const gate = evaluateConsentGate(present, latest);
  if (!gate.ok) {
    const label = (p: PresentParticipant) => ({ identity: p.identity, name: p.name ?? null });
    return {
      ok: false,
      status: 409,
      body: {
        error: 'consent_required',
        message:
          present.length === 0
            ? 'Nobody is in the meeting.'
            : 'Recording starts only after everyone in the meeting has agreed.',
        pending: gate.pending.map(label),
        declined: gate.declined.map(label),
      },
    };
  }
  return {
    ok: true,
    org: org as CamvOrg,
    retentionDays: policy.retentionDays,
    consented: gate.consented,
  };
}

/**
 * Bring every present participant's publish permission in line with the gate:
 * granted → may publish; declined → may publish only while nothing is captured;
 * undecided → may not publish until they answer the banner (late joiners).
 * Called after a capture starts (closes the start race) and after it stops
 * (gives the floor back to those who declined). Returns identities changed.
 */
export async function enforcePublishGate(
  db: Queryable,
  lk: LiveKitOps,
  roomName: string,
  captureActive: boolean,
): Promise<string[]> {
  const present = await lk.presentParticipants(roomName);
  const latest = new Map(
    (await latestDecisions(db, roomName, CONSENT_PURPOSE)).map((d) => [d.identity, d.decision]),
  );
  const changed: string[] = [];
  for (const p of present) {
    const d = latest.get(p.identity);
    const desired = d ? mayPublishAfterDecision(d, captureActive) : false;
    if (desired !== p.canPublish) {
      await lk.setCanPublish(roomName, p.identity, desired);
      changed.push(p.identity);
    }
  }
  return changed;
}
