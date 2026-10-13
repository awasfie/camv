import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hasAdminSecret } from '@/lib/consent/http';
import { normaliseCountry, recordingPolicy, type CamvPlan } from '@/lib/consent/policy';
import { getOrg } from '@/lib/consent/repo';

const PLANS: CamvPlan[] = ['free', 'pro', 'business', 'embed'];
const RETENTION = [30, 90, 365];

/**
 * PUT /api/internal/orgs/:id — upsert Camv's projection of a Passport org
 * (id = Passport organization id) and the booking-host emails that map to it.
 * Server-to-server only (x-camv-admin-secret): Passport provisioning
 * (R1-CV-PASSPORT) and ops. Body:
 *   { name?, country?, plan, recordingRetentionDays?, recordingEnabled?, hostEmails?: string[] }
 * hostEmails is additive: emails are added or re-pointed to this org, never removed.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasAdminSecret(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const plan = body.plan as CamvPlan;
  if (!PLANS.includes(plan)) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
  const country = body.country == null ? null : normaliseCountry(String(body.country));
  if (body.country != null && !country) {
    return NextResponse.json({ error: 'invalid_country' }, { status: 400 });
  }
  const retention =
    body.recordingRetentionDays == null ? null : Number(body.recordingRetentionDays);
  if (retention !== null && !RETENTION.includes(retention)) {
    return NextResponse.json({ error: 'invalid_retention' }, { status: 400 });
  }
  const enabled = body.recordingEnabled == null ? null : body.recordingEnabled === true;
  const hostEmails = Array.isArray(body.hostEmails)
    ? body.hostEmails
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e))
    : [];
  const name = body.name == null ? null : String(body.name).slice(0, 200);

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'consent_store_unavailable' }, { status: 503 });
  try {
    await db.query(
      `INSERT INTO camv_orgs (id, name, country, plan, recording_retention_days, recording_enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country,
         plan = EXCLUDED.plan, recording_retention_days = EXCLUDED.recording_retention_days,
         recording_enabled = EXCLUDED.recording_enabled, updated_at = now()`,
      [id, name, country, plan, retention, enabled],
    );
    for (const email of hostEmails) {
      await db.query(
        `INSERT INTO camv_org_hosts (host_email, org_id) VALUES ($1, $2)
         ON CONFLICT (host_email) DO UPDATE SET org_id = EXCLUDED.org_id`,
        [email, id],
      );
    }
    const org = await getOrg(db, id);
    return NextResponse.json({
      org,
      hostEmailsAdded: hostEmails.length,
      recording: recordingPolicy(org),
    });
  } catch (e) {
    console.error('org upsert failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
