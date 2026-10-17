/**
 * WC-PE-15f2: the clinic-tenant residency guard on the org upsert, against real
 * Postgres semantics (PGlite) with migrations 0001 + 0002 applied, an injected
 * registry and deployment context. Contract: salesos uae-cell.md section 7.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { ResidencyRegistry } from '@family/residency';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setDbForTests, type Queryable } from '../db';
import { upsertOrg } from './upsert';
import { PUT } from '@/app/api/internal/orgs/[id]/route';

const migration = (f: string) => readFileSync(join(__dirname, '../../db/migrations', f), 'utf8');

const ACTIVE: ResidencyRegistry = {
  'uae-1': { country: 'AE', status: 'active' },
  'ksa-1': { country: 'SA', status: 'planned' },
};
const IN_UAE = { cell: 'uae-1' };
const DE_PLANE = { cell: null };

let pg: PGlite;
let db: Queryable;

type Row = Record<string, unknown>;
const row = async (id: string): Promise<Row | undefined> =>
  (
    await db.query<Row>(
      `SELECT id, name, country, plan, vertical, handles_phi, residency_cell, updated_at
         FROM camv_orgs WHERE id = $1`,
      [id],
    )
  ).rows[0];

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(migration('0001_wc_cv_3_consent.sql'));
  // a pre-existing org written before 0002, as in production
  await pg.exec(
    `INSERT INTO camv_orgs (id, name, country, plan) VALUES ('org_old', 'Old', 'AE', 'pro')`,
  );
  await pg.exec(migration('0002_wc_pe_15f_residency.sql'));
  await pg.exec(migration('0002_wc_pe_15f_residency.sql')); // idempotent
  db = {
    async query(text, params) {
      const r = await pg.query(text, params as unknown[]);
      return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
    },
  };
}, 60_000);

describe('migration 0002', () => {
  it('is additive: existing rows keep their data, new columns are NULL, no default', async () => {
    expect(await row('org_old')).toMatchObject({
      name: 'Old',
      plan: 'pro',
      vertical: null,
      handles_phi: null,
      residency_cell: null,
    });
    const sql = migration('0002_wc_pe_15f_residency.sql').replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|DEFAULT)\b/i);
  });
});

describe('non-clinic orgs: behaviour unchanged', () => {
  it('upserts without residency fields on the DE plane (no RESIDENCY_CELL)', async () => {
    const r = await upsertOrg(
      db,
      'org_plain',
      { name: 'Plain', country: 'eg', plan: 'business', hostEmails: ['Host@Plain.test'] },
      { deployment: DE_PLANE },
    );
    expect(r.status).toBe(200);
    expect(r.body.hostEmailsAdded).toBe(1);
    expect(r.body.org).toMatchObject({ id: 'org_plain', country: 'EG', plan: 'business' });
    expect(await row('org_plain')).toMatchObject({ vertical: null, handles_phi: null });
  });
  it('accepts a non-clinic vertical and a cell it does not need', async () => {
    const r = await upsertOrg(
      db,
      'org_retail',
      { plan: 'pro', vertical: 'retail', handlesPhi: false, residencyCell: 'nowhere' },
      { deployment: DE_PLANE },
    );
    expect(r.status).toBe(200);
    expect(await row('org_retail')).toMatchObject({ vertical: 'retail', handles_phi: false });
  });
  it('keeps the existing validation errors', async () => {
    expect((await upsertOrg(db, 'x', { plan: 'gold' })).body).toEqual({ error: 'invalid_plan' });
    expect((await upsertOrg(db, 'x', { plan: 'pro', country: 'zz1' })).body).toEqual({
      error: 'invalid_country',
    });
    expect((await upsertOrg(db, 'x', { plan: 'pro', recordingRetentionDays: 45 })).body).toEqual({
      error: 'invalid_retention',
    });
    expect((await upsertOrg(db, 'x', { plan: 'pro', handlesPhi: 'yes' })).status).toBe(400);
    expect((await upsertOrg(db, 'x', { plan: 'pro', vertical: 7 })).status).toBe(400);
    expect(await row('x')).toBeUndefined();
  });
  it('503 without a database', async () => {
    expect((await upsertOrg(null, 'x', { plan: 'pro' })).status).toBe(503);
  });
});

describe('clinic orgs: residency guard', () => {
  const clinic = (extra: Row = {}) => ({
    name: 'Clinic',
    plan: 'pro',
    vertical: 'clinic',
    ...extra,
  });

  it('clinic without a cell -> 422 residency_cell_required, nothing written', async () => {
    const r = await upsertOrg(db, 'c1', clinic(), { registry: ACTIVE, deployment: IN_UAE });
    expect(r).toEqual({ status: 422, body: { error: 'residency_cell_required' } });
    expect(await row('c1')).toBeUndefined();
  });
  it('unknown cell -> 422 residency_cell_unknown', async () => {
    const r = await upsertOrg(db, 'c2', clinic({ residencyCell: 'eu-1' }), {
      registry: ACTIVE,
      deployment: IN_UAE,
    });
    expect(r).toEqual({ status: 422, body: { error: 'residency_cell_unknown' } });
    expect(await row('c2')).toBeUndefined();
  });
  it('planned cell -> 422 residency_cell_not_active', async () => {
    const r = await upsertOrg(db, 'c3', clinic({ residencyCell: 'ksa-1' }), {
      registry: ACTIVE,
      deployment: { cell: 'ksa-1' },
    });
    expect(r).toEqual({ status: 422, body: { error: 'residency_cell_not_active' } });
    expect(await row('c3')).toBeUndefined();
  });
  it('committed registry (uae-1 planned) refuses every clinic org', async () => {
    const r = await upsertOrg(db, 'c3b', clinic({ residencyCell: 'uae-1' }), {
      deployment: IN_UAE,
    });
    expect(r).toEqual({ status: 422, body: { error: 'residency_cell_not_active' } });
  });
  it('active cell but this deployment is another cell / the DE plane -> residency_cell_mismatch', async () => {
    for (const deployment of [DE_PLANE, { cell: 'ksa-1' }]) {
      const r = await upsertOrg(db, 'c4', clinic({ residencyCell: 'uae-1' }), {
        registry: ACTIVE,
        deployment,
      });
      expect(r).toEqual({ status: 422, body: { error: 'residency_cell_mismatch' } });
    }
    expect(await row('c4')).toBeUndefined();
  });
  it('active cell matching RESIDENCY_CELL -> 200 and the residency columns are stored', async () => {
    const r = await upsertOrg(db, 'c5', clinic({ vertical: ' Clinic ', residencyCell: 'uae-1' }), {
      registry: ACTIVE,
      deployment: IN_UAE,
    });
    expect(r.status).toBe(200);
    expect(r.body.residency).toEqual({
      vertical: 'Clinic',
      handlesPhi: null,
      residencyCell: 'uae-1',
    });
    expect(await row('c5')).toMatchObject({ vertical: 'Clinic', residency_cell: 'uae-1' });
    // a later update that omits the residency fields keeps them and is re-checked
    const again = await upsertOrg(
      db,
      'c5',
      { plan: 'business' },
      { registry: ACTIVE, deployment: IN_UAE },
    );
    expect(again.status).toBe(200);
    expect(await row('c5')).toMatchObject({
      plan: 'business',
      vertical: 'Clinic',
      residency_cell: 'uae-1',
    });
    // ...and the same stored clinic org is refused on a deployment outside its cell
    const elsewhere = await upsertOrg(
      db,
      'c5',
      { plan: 'free' },
      { registry: ACTIVE, deployment: DE_PLANE },
    );
    expect(elsewhere).toEqual({ status: 422, body: { error: 'residency_cell_mismatch' } });
    expect(await row('c5')).toMatchObject({ plan: 'business' });
  });
  it('handlesPhi=true is treated as clinic', async () => {
    const r = await upsertOrg(
      db,
      'c6',
      { plan: 'pro', vertical: 'retail', handlesPhi: true },
      {
        registry: ACTIVE,
        deployment: IN_UAE,
      },
    );
    expect(r).toEqual({ status: 422, body: { error: 'residency_cell_required' } });
    expect(await row('c6')).toBeUndefined();
  });
  it('existing non-clinic org updated to vertical=clinic -> 422 and the row is untouched', async () => {
    const before = await row('org_old');
    for (const body of [
      { name: 'Hijack', plan: 'business', vertical: 'clinic' },
      { name: 'Hijack', plan: 'business', handlesPhi: true },
      { name: 'Hijack', plan: 'business', vertical: 'CLINIC', residencyCell: 'uae-1' },
    ]) {
      const r = await upsertOrg(db, 'org_old', body, { registry: ACTIVE, deployment: DE_PLANE });
      expect(r.status).toBe(422);
    }
    expect(await row('org_old')).toEqual(before);
  });
  it('a stored clinic flag cannot be dodged by omitting it; clearing it is an explicit null', async () => {
    await pg.exec(`INSERT INTO camv_orgs (id, plan, vertical) VALUES ('c7', 'pro', 'clinic')`);
    const omit = await upsertOrg(
      db,
      'c7',
      { plan: 'free' },
      { registry: ACTIVE, deployment: DE_PLANE },
    );
    expect(omit).toEqual({ status: 422, body: { error: 'residency_cell_required' } });
    const cleared = await upsertOrg(
      db,
      'c7',
      { plan: 'free', vertical: null },
      {
        registry: ACTIVE,
        deployment: DE_PLANE,
      },
    );
    expect(cleared.status).toBe(200);
  });
});

describe('PUT /api/internal/orgs/:id (route, committed registry, env RESIDENCY_CELL)', () => {
  const SECRET = 'test-admin-secret';
  const env = { ...process.env };
  beforeEach(() => {
    process.env.CAMV_ADMIN_SECRET = SECRET;
    delete process.env.RESIDENCY_CELL;
    setDbForTests(db);
  });
  afterAll(() => {
    process.env = env;
    setDbForTests(undefined);
  });
  const put = (id: string, body: unknown) =>
    PUT(
      new NextRequest(`http://camv.test/api/internal/orgs/${id}`, {
        method: 'PUT',
        headers: { 'x-camv-admin-secret': SECRET, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it('non-clinic upsert -> 200 as before', async () => {
    const res = await put('r_plain', { plan: 'pro', country: 'AE' });
    expect(res.status).toBe(200);
    expect((await res.json()).org).toMatchObject({ id: 'r_plain', plan: 'pro' });
  });
  it('clinic upsert -> 422 { error: code }, even with RESIDENCY_CELL=uae-1 (cell is planned)', async () => {
    process.env.RESIDENCY_CELL = 'uae-1';
    const res = await put('r_clinic', { plan: 'pro', vertical: 'clinic', residencyCell: 'uae-1' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'residency_cell_not_active' });
    expect(await row('r_clinic')).toBeUndefined();
  });
  it('non-object body -> 400', async () => {
    expect((await put('r_arr', [1])).status).toBe(400);
  });
});
