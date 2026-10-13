/**
 * WC-CV-3 (Bible v12.6 WC.3.4, CC-70) — pure consent / retention policy.
 * No I/O here: every rule the routes and the retention job apply is in this file
 * so it is unit-tested once.
 */

/** One consent covers recording AND the transcription/summary derived from it. */
export const CONSENT_PURPOSE = 'recording_transcription' as const;
export type ConsentPurpose = typeof CONSENT_PURPOSE;

export type ConsentDecision = 'granted' | 'declined';
export type ConsentLocale = 'en' | 'ar';

export type CamvPlan = 'free' | 'pro' | 'business' | 'embed';

export type CamvOrg = {
  id: string;
  name: string | null;
  /** ISO 3166-1 alpha-2, upper-case; null when the org never set it. */
  country: string | null;
  plan: CamvPlan;
  /** UX.6 Settings choice (30/90/365) or null = plan default. */
  recordingRetentionDays: number | null;
  /** null = country default. */
  recordingEnabled: boolean | null;
};

/**
 * CM.4 cloud recording retention: Free none, Pro 30 days, Business 1 year.
 * Embed: "to customer's bucket or ours" with no retention line in CM.4 → the
 * Business ceiling, default 30 days (decision recorded on WC-CV-3).
 */
const PLAN_RETENTION: Record<CamvPlan, { defaultDays: number; maxDays: number } | null> = {
  free: null,
  pro: { defaultDays: 30, maxDays: 30 },
  business: { defaultDays: 365, maxDays: 365 },
  embed: { defaultDays: 30, maxDays: 365 },
};

/**
 * R3-30 default (b) "recording disabled for Egypt-country orgs" stays in force
 * until Ahmed's R3-30 ruling changes it; an org setting cannot override it.
 */
export const RECORDING_BLOCKED_COUNTRIES: ReadonlySet<string> = new Set(['EG']);

export type RecordingPolicy =
  | { allowed: true; retentionDays: number }
  | {
      allowed: false;
      reason:
        | 'no_org'
        | 'plan_has_no_cloud_recording'
        | 'country_blocked_r3_30'
        | 'disabled_by_org';
    };

export function normaliseCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export function retentionDaysFor(
  org: Pick<CamvOrg, 'plan' | 'recordingRetentionDays'>,
): number | null {
  const p = PLAN_RETENTION[org.plan];
  if (!p) return null;
  const chosen = org.recordingRetentionDays;
  if (chosen && chosen > 0 && chosen <= p.maxDays) return chosen;
  return p.defaultDays;
}

export function recordingPolicy(org: CamvOrg | null): RecordingPolicy {
  if (!org) return { allowed: false, reason: 'no_org' };
  const country = normaliseCountry(org.country);
  if (country && RECORDING_BLOCKED_COUNTRIES.has(country)) {
    return { allowed: false, reason: 'country_blocked_r3_30' };
  }
  const days = retentionDaysFor(org);
  if (days === null) return { allowed: false, reason: 'plan_has_no_cloud_recording' };
  if (org.recordingEnabled === false) return { allowed: false, reason: 'disabled_by_org' };
  return { allowed: true, retentionDays: days };
}

export const POLICY_MESSAGES: Record<
  Exclude<RecordingPolicy, { allowed: true }>['reason'],
  string
> = {
  no_org: 'Recording is not enabled for this meeting: its host is not linked to a Camv workspace.',
  plan_has_no_cloud_recording: 'Cloud recording is not included in this workspace plan.',
  country_blocked_r3_30:
    'Recording is turned off for workspaces in Egypt until the data-transfer authorisation is in place.',
  disabled_by_org: 'Recording is turned off in this workspace settings.',
};

export type PresentParticipant = { identity: string; name?: string | null };
export type LatestDecision = { identity: string; decision: ConsentDecision };

export type GateResult =
  | { ok: true; consented: string[] }
  | { ok: false; pending: PresentParticipant[]; declined: PresentParticipant[] };

/**
 * CC-70: recording/transcription may start only when EVERY present participant's
 * latest decision for the purpose is "granted". Nobody present → refuse (an empty
 * room has nothing to record and nobody who consented).
 */
export function evaluateConsentGate(
  present: PresentParticipant[],
  latest: LatestDecision[],
): GateResult {
  const byIdentity = new Map(latest.map((d) => [d.identity, d.decision]));
  const pending: PresentParticipant[] = [];
  const declined: PresentParticipant[] = [];
  for (const p of present) {
    const d = byIdentity.get(p.identity);
    if (d === 'granted') continue;
    if (d === 'declined') declined.push(p);
    else pending.push(p);
  }
  if (present.length === 0) return { ok: false, pending: [], declined: [] };
  if (pending.length || declined.length) return { ok: false, pending, declined };
  return { ok: true, consented: present.map((p) => p.identity) };
}

/**
 * Late joiners are gated before publishing (WC-CV-3 step 1). After a decision the
 * participant may publish when they granted, or when nothing is being captured.
 */
export function mayPublishAfterDecision(
  decision: ConsentDecision,
  captureActive: boolean,
): boolean {
  return decision === 'granted' || !captureActive;
}

export function isConsentDecision(v: unknown): v is ConsentDecision {
  return v === 'granted' || v === 'declined';
}

export function isConsentLocale(v: unknown): v is ConsentLocale {
  return v === 'en' || v === 'ar';
}

export function deleteAfter(startedAt: Date, retentionDays: number): Date {
  return new Date(startedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}
