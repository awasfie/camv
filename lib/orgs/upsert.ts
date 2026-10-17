import {
  checkTenantResidency,
  deploymentContextFromEnv,
  RESIDENCY_CELLS,
  type DeploymentContext,
  type ResidencyRegistry,
} from '@family/residency';
import type { Queryable } from '@/lib/db';
import { normaliseCountry, recordingPolicy, type CamvPlan } from '@/lib/consent/policy';
import { getOrg } from '@/lib/consent/repo';

const PLANS: CamvPlan[] = ['free', 'pro', 'business', 'embed'];
const RETENTION = [30, 90, 365];

export type UpsertResult = { status: number; body: Record<string, unknown> };

export type UpsertOptions = {
  /** Test hook; production uses the committed registry from @family/residency. */
  registry?: ResidencyRegistry;
  /** Test hook; production reads RESIDENCY_CELL from the environment. */
  deployment?: DeploymentContext;
};

type ResidencyRow = {
  vertical: string | null;
  handles_phi: boolean | null;
  residency_cell: string | null;
};

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Optional residency field: absent = keep the stored value; null = clear; else validated. */
function readText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): { set: false } | { set: true; value: string | null } | 'invalid' {
  if (!has(body, key)) return { set: false };
  const v = body[key];
  if (v === null) return { set: true, value: null };
  if (typeof v !== 'string') return 'invalid';
  const t = v.trim();
  if (t.length > max) return 'invalid';
  return { set: true, value: t === '' ? null : t };
}

/**
 * Upsert Camv's projection of a Passport org (PUT /api/internal/orgs/:id).
 *
 * WC-PE-15f2: before ANY write the body is merged with the stored row and the
 * merged tenant goes through checkTenantResidency (uae-cell.md section 7), so an
 * update that flips an existing org to clinic is refused too. Refusal -> 422
 * { error: <code> } and nothing is written. The write is conditional on the
 * residency fields still matching what was checked (409 concurrent_update
 * otherwise), so a racing writer cannot slip a clinic flag past the guard.
 * Non-clinic orgs behave exactly as before.
 */
export async function upsertOrg(
  db: Queryable | null,
  id: string,
  body: Record<string, unknown>,
  opts: UpsertOptions = {},
): Promise<UpsertResult> {
  const bad = (error: string, status = 400): UpsertResult => ({ status, body: { error } });

  const plan = body.plan as CamvPlan;
  if (!PLANS.includes(plan)) return bad('invalid_plan');
  const country = body.country == null ? null : normaliseCountry(String(body.country));
  if (body.country != null && !country) return bad('invalid_country');
  const retention =
    body.recordingRetentionDays == null ? null : Number(body.recordingRetentionDays);
  if (retention !== null && !RETENTION.includes(retention)) return bad('invalid_retention');
  const enabled = body.recordingEnabled == null ? null : body.recordingEnabled === true;
  const hostEmails = Array.isArray(body.hostEmails)
    ? body.hostEmails
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e))
    : [];
  const name = body.name == null ? null : String(body.name).slice(0, 200);

  const vertical = readText(body, 'vertical', 64);
  if (vertical === 'invalid') return bad('invalid_vertical');
  const cell = readText(body, 'residencyCell', 32);
  if (cell === 'invalid') return bad('invalid_residency_cell');
  let phi: { set: false } | { set: true; value: boolean | null } = { set: false };
  if (has(body, 'handlesPhi')) {
    const v = body.handlesPhi;
    if (v !== null && typeof v !== 'boolean') return bad('invalid_handles_phi');
    phi = { set: true, value: v };
  }

  if (!db) return bad('consent_store_unavailable', 503);

  // Merge with the stored row (absent row = all null) and check before writing.
  const { rows } = await db.query<ResidencyRow>(
    'SELECT o.vertical, o.handles_phi, o.residency_cell FROM camv_orgs o WHERE o.id = $1',
    [id],
  );
  const prev: ResidencyRow = rows[0] ?? { vertical: null, handles_phi: null, residency_cell: null };
  const next: ResidencyRow = {
    vertical: vertical.set ? vertical.value : prev.vertical,
    handles_phi: phi.set ? phi.value : prev.handles_phi,
    residency_cell: cell.set ? cell.value : prev.residency_cell,
  };
  const verdict = checkTenantResidency(
    { vertical: next.vertical, handlesPhi: next.handles_phi, residencyCell: next.residency_cell },
    opts.deployment ?? deploymentContextFromEnv(),
    opts.registry ?? RESIDENCY_CELLS,
  );
  if (!verdict.ok) return bad(verdict.code, 422);

  const written = await db.query(
    `INSERT INTO camv_orgs (id, name, country, plan, recording_retention_days, recording_enabled,
                            vertical, handles_phi, residency_cell)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country,
       plan = EXCLUDED.plan, recording_retention_days = EXCLUDED.recording_retention_days,
       recording_enabled = EXCLUDED.recording_enabled, vertical = EXCLUDED.vertical,
       handles_phi = EXCLUDED.handles_phi, residency_cell = EXCLUDED.residency_cell,
       updated_at = now()
     WHERE camv_orgs.vertical IS NOT DISTINCT FROM $10
       AND camv_orgs.handles_phi IS NOT DISTINCT FROM $11
       AND camv_orgs.residency_cell IS NOT DISTINCT FROM $12`,
    [
      id,
      name,
      country,
      plan,
      retention,
      enabled,
      next.vertical,
      next.handles_phi,
      next.residency_cell,
      prev.vertical,
      prev.handles_phi,
      prev.residency_cell,
    ],
  );
  if (written.rowCount === 0) return bad('concurrent_update', 409);

  for (const email of hostEmails) {
    await db.query(
      `INSERT INTO camv_org_hosts (host_email, org_id) VALUES ($1, $2)
       ON CONFLICT (host_email) DO UPDATE SET org_id = EXCLUDED.org_id`,
      [email, id],
    );
  }
  const org = await getOrg(db, id);
  return {
    status: 200,
    body: {
      org,
      residency: {
        vertical: next.vertical,
        handlesPhi: next.handles_phi,
        residencyCell: next.residency_cell,
      },
      hostEmailsAdded: hostEmails.length,
      recording: recordingPolicy(org),
    },
  };
}
