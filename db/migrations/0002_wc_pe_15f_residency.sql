-- WC-PE-15f2 (Bible WC-31 / WC-29): clinic-tenant residency guard inputs on the
-- org projection. Contract: awasfie/salesos docs/platform/residency/uae-cell.md section 7.
-- Additive only (live-data floor): nullable columns, no default, no backfill, no DROP.
-- Existing rows read as non-clinic (vertical NULL, handles_phi NULL) and keep passing.
ALTER TABLE camv_orgs
  ADD COLUMN IF NOT EXISTS vertical text,
  ADD COLUMN IF NOT EXISTS handles_phi boolean,
  ADD COLUMN IF NOT EXISTS residency_cell text;
