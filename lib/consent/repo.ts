/**
 * WC-CV-3 data access. Every SELECT names its columns. No DELETE anywhere: the
 * consent record is append-only and recordings are marked deleted, never removed.
 */
import type { Queryable } from '../db';
import type { CamvOrg, CamvPlan, ConsentDecision, ConsentLocale, LatestDecision } from './policy';
import { normaliseCountry } from './policy';

type OrgRow = {
  id: string;
  name: string | null;
  country: string | null;
  plan: CamvPlan;
  recording_retention_days: number | null;
  recording_enabled: boolean | null;
};

const ORG_COLUMNS =
  'o.id, o.name, o.country, o.plan, o.recording_retention_days, o.recording_enabled';

function toOrg(r: OrgRow): CamvOrg {
  return {
    id: r.id,
    name: r.name,
    country: normaliseCountry(r.country),
    plan: r.plan,
    recordingRetentionDays: r.recording_retention_days,
    recordingEnabled: r.recording_enabled,
  };
}

export async function getOrg(db: Queryable, orgId: string): Promise<CamvOrg | null> {
  const { rows } = await db.query<OrgRow>(
    `SELECT ${ORG_COLUMNS} FROM camv_orgs o WHERE o.id = $1`,
    [orgId],
  );
  return rows[0] ? toOrg(rows[0]) : null;
}

export async function getOrgByHostEmail(db: Queryable, email: string): Promise<CamvOrg | null> {
  const { rows } = await db.query<OrgRow>(
    `SELECT ${ORG_COLUMNS} FROM camv_org_hosts h JOIN camv_orgs o ON o.id = h.org_id
      WHERE h.host_email = $1`,
    [email.trim().toLowerCase()],
  );
  return rows[0] ? toOrg(rows[0]) : null;
}

export async function bindRoom(
  db: Queryable,
  roomId: string,
  orgId: string,
  country: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO camv_rooms (room_id, org_id, country) VALUES ($1, $2, $3)
     ON CONFLICT (room_id) DO UPDATE SET org_id = EXCLUDED.org_id,
       country = EXCLUDED.country, last_seen = now()`,
    [roomId, orgId, country],
  );
}

/** The org bound to a room at join, re-read so plan/country changes apply. */
export async function getRoomOrg(db: Queryable, roomId: string): Promise<CamvOrg | null> {
  const { rows } = await db.query<OrgRow>(
    `SELECT ${ORG_COLUMNS} FROM camv_rooms r JOIN camv_orgs o ON o.id = r.org_id
      WHERE r.room_id = $1`,
    [roomId],
  );
  return rows[0] ? toOrg(rows[0]) : null;
}

export type ConsentEventInput = {
  roomId: string;
  participantId: string;
  identity: string;
  participantName: string | null;
  orgId: string;
  country: string;
  purpose: string;
  decision: ConsentDecision;
  locale: ConsentLocale;
  textVersion: string;
};

export async function insertConsentEvent(
  db: Queryable,
  e: ConsentEventInput,
): Promise<{ id: string; ts: Date }> {
  const { rows } = await db.query<{ id: string; ts: Date }>(
    `INSERT INTO consent_events
       (room_id, participant_id, identity, participant_name, org_id, country,
        purpose, decision, locale, text_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, ts`,
    [
      e.roomId,
      e.participantId,
      e.identity,
      e.participantName,
      e.orgId,
      e.country,
      e.purpose,
      e.decision,
      e.locale,
      e.textVersion,
    ],
  );
  return { id: String(rows[0].id), ts: rows[0].ts };
}

export type LatestConsentRow = LatestDecision & {
  participantId: string;
  participantName: string | null;
  locale: ConsentLocale;
  ts: Date;
};

/** Latest decision per identity for one room and purpose. */
export async function latestDecisions(
  db: Queryable,
  roomId: string,
  purpose: string,
): Promise<LatestConsentRow[]> {
  const { rows } = await db.query<{
    identity: string;
    decision: ConsentDecision;
    participant_id: string;
    participant_name: string | null;
    locale: ConsentLocale;
    ts: Date;
  }>(
    `SELECT DISTINCT ON (identity) identity, decision, participant_id, participant_name, locale, ts
       FROM consent_events
      WHERE room_id = $1 AND purpose = $2
      ORDER BY identity, ts DESC, id DESC`,
    [roomId, purpose],
  );
  return rows.map((r) => ({
    identity: r.identity,
    decision: r.decision,
    participantId: r.participant_id,
    participantName: r.participant_name,
    locale: r.locale,
    ts: r.ts,
  }));
}

export type RecordingInput = {
  roomId: string;
  orgId: string;
  egressId: string;
  bucket: string;
  objectKey: string;
  startedAt: Date;
  retentionDays: number;
  deleteAfter: Date;
  consentSnapshot: string[];
};

export async function insertRecording(db: Queryable, r: RecordingInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO camv_recordings
       (room_id, org_id, egress_id, bucket, object_key, started_at, retention_days,
        delete_after, consent_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING id`,
    [
      r.roomId,
      r.orgId,
      r.egressId,
      r.bucket,
      r.objectKey,
      r.startedAt,
      r.retentionDays,
      r.deleteAfter,
      JSON.stringify(r.consentSnapshot),
    ],
  );
  return rows[0].id;
}

export type DueRecording = {
  id: string;
  orgId: string;
  egressId: string | null;
  bucket: string;
  objectKey: string;
  retentionDays: number;
  deleteAfter: Date;
};

export async function dueRecordings(
  db: Queryable,
  now: Date,
  limit: number,
): Promise<DueRecording[]> {
  const { rows } = await db.query<{
    id: string;
    org_id: string;
    egress_id: string | null;
    bucket: string;
    object_key: string;
    retention_days: number;
    delete_after: Date;
  }>(
    `SELECT id, org_id, egress_id, bucket, object_key, retention_days, delete_after
       FROM camv_recordings
      WHERE deleted_at IS NULL AND delete_after <= $1
      ORDER BY delete_after
      LIMIT $2`,
    [now, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    egressId: r.egress_id,
    bucket: r.bucket,
    objectKey: r.object_key,
    retentionDays: r.retention_days,
    deleteAfter: r.delete_after,
  }));
}

export type DeletionOutcome = 'deleted' | 'already_absent' | 'failed';

export async function logDeletion(
  db: Queryable,
  rec: DueRecording,
  runId: string,
  outcome: DeletionOutcome,
  r2Status: number | null,
  detail: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO camv_recording_deletions
       (recording_id, org_id, egress_id, bucket, object_key, retention_days, delete_after,
        run_id, outcome, r2_status, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      rec.id,
      rec.orgId,
      rec.egressId,
      rec.bucket,
      rec.objectKey,
      rec.retentionDays,
      rec.deleteAfter,
      runId,
      outcome,
      r2Status,
      detail,
    ],
  );
  if (outcome !== 'failed') {
    await db.query(
      `UPDATE camv_recordings SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [rec.id],
    );
  }
}

export type ConsentExportRow = {
  ts: Date;
  room_id: string;
  participant_id: string;
  identity: string;
  participant_name: string | null;
  purpose: string;
  decision: string;
  locale: string;
  country: string;
  text_version: string;
};

export async function consentExportRows(
  db: Queryable,
  orgId: string,
  from: Date | null,
  to: Date | null,
): Promise<ConsentExportRow[]> {
  const { rows } = await db.query<ConsentExportRow>(
    `SELECT ts, room_id, participant_id, identity, participant_name, purpose, decision,
            locale, country, text_version
       FROM consent_events
      WHERE org_id = $1
        AND ($2::timestamptz IS NULL OR ts >= $2)
        AND ($3::timestamptz IS NULL OR ts < $3)
      ORDER BY ts, id`,
    [orgId, from, to],
  );
  return rows;
}

export type DeletionExportRow = {
  logged_at: Date;
  recording_id: string;
  egress_id: string | null;
  bucket: string;
  object_key: string;
  retention_days: number;
  delete_after: Date;
  run_id: string;
  outcome: string;
  r2_status: number | null;
};

export async function deletionExportRows(
  db: Queryable,
  orgId: string,
  from: Date | null,
  to: Date | null,
): Promise<DeletionExportRow[]> {
  const { rows } = await db.query<DeletionExportRow>(
    `SELECT logged_at, recording_id, egress_id, bucket, object_key, retention_days,
            delete_after, run_id, outcome, r2_status
       FROM camv_recording_deletions
      WHERE org_id = $1
        AND ($2::timestamptz IS NULL OR logged_at >= $2)
        AND ($3::timestamptz IS NULL OR logged_at < $3)
      ORDER BY logged_at, id`,
    [orgId, from, to],
  );
  return rows;
}
