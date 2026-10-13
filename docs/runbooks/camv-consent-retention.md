# Camv consent gate + retention: rollout (WC-CV-3)

Effects below are run by cards (R-53: a deploy exists only as a cron-run card);
this file is the procedure those cards follow. Secrets by name only.

## 1. Database (effect, D-R70 70-6)

1. Create a Postgres for Camv in Coolify on NEW_SERVER (`camv-db`), with the
   R1-CV-BACKUP / WC-PE-5 WAL archive attached before any data lands.
2. Store its URL as `CAMV_DATABASE_URL` in Infisical and the camv app env.
3. Dry run, then apply, from inside the deployed container:
   `node scripts/db-migrate.mjs` → `applied=0 pending=1 0001_wc_cv_3_consent.sql`
   `node scripts/db-migrate.mjs --apply` → `applied 0001_wc_cv_3_consent.sql <sha>`
   The script refuses DROP/TRUNCATE/DELETE and any edited, already-applied file.
4. Health: `GET /api/consent/roster?roomName=x` without proof → 403 (route up).

Rollback: the migration only creates new tables; unsetting `CAMV_DATABASE_URL`
returns the app to pre-WC-CV-3 behaviour (no banner, recording refuses 503).

## 2. Env (camv app)

| Name                | Purpose                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAMV_DATABASE_URL` | consent store                                                                                                                                 |
| `CAMV_ADMIN_SECRET` | `x-camv-admin-secret` for org upsert, consent export, retention run; new, generated per environment; never the Timeway `CAMV_INTERNAL_SECRET` |
| `RECORDING_S3_*`    | existing; the retention job reuses them for HEAD/DELETE                                                                                       |

## 3. Org projection

Until R1-CV-PASSPORT pushes orgs, ops upserts each recording customer:

    PUT /api/internal/orgs/<passport-org-id>
    x-camv-admin-secret: $CAMV_ADMIN_SECRET
    {"name":"…","country":"AE","plan":"pro","hostEmails":["host@customer.com"]}

The response echoes the effective policy (`recording.allowed`, `retentionDays`
or the refusal reason). Rooms whose host maps to no org cannot be recorded.

## 4. Retention schedule

Coolify scheduled task on the camv app, daily 03:15 UTC:

    curl -fsS -X POST -H "x-camv-admin-secret: $CAMV_ADMIN_SECRET" \
      http://localhost:3000/api/internal/retention

200 = all due deleted; 207 = some failed (retried next run; the log carries
the R2 status); 503 = DB or R2 env missing. First run with `?dryRun=1`.

## 5. CC-70 proof

1. Room with host + guest, org on Pro: start recording before the guest agrees
   → 409 `consent_required` listing the guest.
2. Guest agrees → start 200; `consent-export` CSV has one `granted` row per
   participant with identity, ts, purpose, locale.
3. Recording past retention (set `delete_after` via a test org on a 30-day plan,
   or wait): retention run → R2 HEAD 404 and a `deleted` row in
   `consent-export?type=deletions`.
