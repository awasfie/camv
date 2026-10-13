-- WC-CV-3 (Bible v12.6 WC.3.4, CC-70): consent gate, retention lifecycle, export.
-- Additive only (D-R70 70-6 / live-data floor): CREATE ... IF NOT EXISTS, no DROP,
-- no data rewrite. Applied by scripts/db-migrate.mjs, which records the file in
-- camv_schema_migrations and never re-runs it.

-- Projection of the Passport organization Camv needs at request time. The row id IS
-- the Passport organization id (AL2-13: no second tenant truth). Written by Passport
-- provisioning (R1-CV-PASSPORT); until that lands, by the ops script only.
CREATE TABLE IF NOT EXISTS camv_orgs (
  id                       text PRIMARY KEY,
  name                     text,
  country                  char(2),
  plan                     text NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free', 'pro', 'business', 'embed')),
  -- UX.6 Settings: recordings 30/90/365 days. NULL = the plan default (CM.4).
  recording_retention_days integer CHECK (recording_retention_days IN (30, 90, 365)),
  -- NULL = the country default: off for EG while R3-30 (b) is in force, on elsewhere.
  recording_enabled        boolean,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Booking host -> org, until Passport SSO hands Camv the org directly.
CREATE TABLE IF NOT EXISTS camv_org_hosts (
  host_email text PRIMARY KEY CHECK (host_email = lower(host_email)),
  org_id     text NOT NULL REFERENCES camv_orgs (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Room -> org binding, written by the token endpoint at join so the consent,
-- roster and recording routes never re-resolve the booking.
CREATE TABLE IF NOT EXISTS camv_rooms (
  room_id    text PRIMARY KEY,
  org_id     text NOT NULL,
  country    char(2),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now()
);

-- One row per consent decision; the latest row per (room, identity, purpose) wins.
-- Fields per WC-CV-3 step 1: {roomId, participantId, identity, ts, purpose, locale}.
CREATE TABLE IF NOT EXISTS consent_events (
  id               bigserial PRIMARY KEY,
  room_id          text NOT NULL,
  participant_id   text NOT NULL,
  identity         text NOT NULL,
  participant_name text,
  org_id           text NOT NULL,
  country          char(2) NOT NULL,
  purpose          text NOT NULL,
  decision         text NOT NULL CHECK (decision IN ('granted', 'declined')),
  locale           text NOT NULL CHECK (locale IN ('en', 'ar')),
  text_version     text NOT NULL,
  ts               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_events_room_identity_idx
  ON consent_events (room_id, identity, purpose, ts DESC, id DESC);
CREATE INDEX IF NOT EXISTS consent_events_org_ts_idx ON consent_events (org_id, ts);

-- The consent record is evidence: rows are never edited or removed.
CREATE OR REPLACE FUNCTION consent_events_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent_events is append-only';
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'consent_events_append_only'
       AND tgrelid = 'consent_events'::regclass
  ) THEN
    CREATE TRIGGER consent_events_append_only BEFORE UPDATE OR DELETE ON consent_events
      FOR EACH ROW EXECUTE FUNCTION consent_events_append_only();
  END IF;
END;
$$;

-- Every recording Camv starts. The retention job deletes ONLY objects listed here
-- (never a bucket sweep), at delete_after = started_at + retention_days.
CREATE TABLE IF NOT EXISTS camv_recordings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          text NOT NULL,
  org_id           text NOT NULL,
  egress_id        text UNIQUE,
  bucket           text NOT NULL,
  object_key       text NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  retention_days   integer NOT NULL CHECK (retention_days > 0),
  delete_after     timestamptz NOT NULL,
  deleted_at       timestamptz,
  -- identities whose latest decision was 'granted' when the recording started
  consent_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS camv_recordings_due_idx
  ON camv_recordings (delete_after) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS camv_recordings_org_idx ON camv_recordings (org_id, started_at);

-- Deletion log: one row per attempt, written by the retention job.
CREATE TABLE IF NOT EXISTS camv_recording_deletions (
  id             bigserial PRIMARY KEY,
  recording_id   uuid NOT NULL REFERENCES camv_recordings (id),
  org_id         text NOT NULL,
  egress_id      text,
  bucket         text NOT NULL,
  object_key     text NOT NULL,
  retention_days integer NOT NULL,
  delete_after   timestamptz NOT NULL,
  run_id         text NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN ('deleted', 'already_absent', 'failed')),
  r2_status      integer,
  detail         text,
  logged_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS camv_recording_deletions_org_idx
  ON camv_recording_deletions (org_id, logged_at);
