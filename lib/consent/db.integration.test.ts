/**
 * WC-CV-3 against real Postgres semantics (PGlite = Postgres compiled to WASM):
 * the migration applies, the consent record is append-only, the gate refuses
 * until everyone present agreed, retention deletes exactly the due objects and
 * logs them, and the export returns the org's rows only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Queryable } from '../db';
import type { ObjectStore } from '../r2';
import { checkCaptureGate, enforcePublishGate } from './gate';
import type { LiveKitOps } from './livekit';
import { CONSENT_PURPOSE } from './policy';
import {
  bindRoom,
  consentExportRows,
  deletionExportRows,
  getOrgByHostEmail,
  insertConsentEvent,
  insertRecording,
  latestDecisions,
} from './repo';
import { runRetention } from './retention';

const MIGRATION = readFileSync(
  join(__dirname, '../../db/migrations/0001_wc_cv_3_consent.sql'),
  'utf8',
);

let pg: PGlite;
let db: Queryable;

function fakeLiveKit(
  people: { identity: string; name: string; canPublish?: boolean }[],
  active = false,
) {
  const perms = new Map(people.map((p) => [p.identity, p.canPublish ?? false]));
  const ops: LiveKitOps & { perms: Map<string, boolean>; people: typeof people } = {
    perms,
    people,
    async presentParticipants() {
      return people.map((p) => ({
        identity: p.identity,
        name: p.name,
        sid: `PA_${p.identity}`,
        canPublish: perms.get(p.identity)!,
      }));
    },
    async getParticipant(_r, identity) {
      const p = people.find((x) => x.identity === identity);
      return p ? { sid: `PA_${identity}`, name: p.name, canPublish: perms.get(identity)! } : null;
    },
    async captureActive() {
      return active;
    },
    async setCanPublish(_r, identity, canPublish) {
      perms.set(identity, canPublish);
    },
    async verifyParticipantToken() {
      return null;
    },
  };
  return ops;
}

const consent = (
  room: string,
  identity: string,
  decision: 'granted' | 'declined',
  org = 'org_ae',
) =>
  insertConsentEvent(db, {
    roomId: room,
    participantId: `PA_${identity}`,
    identity,
    participantName: identity,
    orgId: org,
    country: 'AE',
    purpose: CONSENT_PURPOSE,
    decision,
    locale: 'en',
    textVersion: 'test',
  });

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(MIGRATION);
  // idempotent: re-applying is a no-op (IF NOT EXISTS / guarded trigger)
  await pg.exec(MIGRATION);
  db = {
    async query(text, params) {
      const r = await pg.query(text, params as unknown[]);
      return { rows: r.rows as never[], rowCount: r.affectedRows ?? r.rows.length };
    },
  };
  await db.query(
    `INSERT INTO camv_orgs (id, name, country, plan) VALUES
       ('org_ae', 'AE Co', 'AE', 'pro'), ('org_eg', 'EG Co', 'EG', 'business'),
       ('org_free', 'Free Co', 'SA', 'free'), ('org_sa', 'SA Co', 'SA', 'business')`,
  );
  await db.query(
    `INSERT INTO camv_org_hosts (host_email, org_id) VALUES
       ('host@ae.test', 'org_ae'), ('host@eg.test', 'org_eg'), ('host@free.test', 'org_free'), ('host@sa.test', 'org_sa')`,
  );
}, 60_000);

describe('schema', () => {
  it('rejects a retention outside 30/90/365 and an unknown plan', async () => {
    await expect(
      db.query(`UPDATE camv_orgs SET recording_retention_days = 45 WHERE id = 'org_ae'`),
    ).rejects.toThrow();
    await expect(
      db.query(`UPDATE camv_orgs SET plan = 'gold' WHERE id = 'org_ae'`),
    ).rejects.toThrow();
  });
  it('consent_events is append-only (no UPDATE, no DELETE)', async () => {
    await consent('room-ro', 'x', 'granted');
    await expect(db.query(`UPDATE consent_events SET decision = 'declined'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query(`DELETE FROM consent_events`)).rejects.toThrow(/append-only/);
  });
  it('resolves the host email case-insensitively', async () => {
    expect((await getOrgByHostEmail(db, ' Host@AE.test '))?.id).toBe('org_ae');
    expect(await getOrgByHostEmail(db, 'nobody@x.test')).toBeNull();
  });
});

describe('capture gate (CC-70)', () => {
  it('refuses with 409 until every present participant agreed, then passes', async () => {
    await bindRoom(db, 'room-1', 'org_ae', 'AE');
    const lk = fakeLiveKit([
      { identity: 'host', name: 'Host' },
      { identity: 'guest', name: 'Guest' },
    ]);
    let g = await checkCaptureGate(db, lk, 'room-1');
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.status).toBe(409);
      expect((g.body.pending as unknown[]).length).toBe(2);
    }
    await consent('room-1', 'host', 'granted');
    await consent('room-1', 'guest', 'declined');
    g = await checkCaptureGate(db, lk, 'room-1');
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.body.declined).toEqual([{ identity: 'guest', name: 'Guest' }]);

    await consent('room-1', 'guest', 'granted'); // changes their mind: latest row wins
    g = await checkCaptureGate(db, lk, 'room-1');
    expect(g).toMatchObject({ ok: true, retentionDays: 30, consented: ['host', 'guest'] });

    // late joiner reopens the gate
    lk.people.push({ identity: 'late', name: 'Late' });
    lk.perms.set('late', false);
    g = await checkCaptureGate(db, lk, 'room-1');
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.body.pending).toEqual([{ identity: 'late', name: 'Late' }]);
  });

  it('refuses 403 for Egypt (R3-30 b), Free plan and unbound rooms; 503 without a store', async () => {
    const lk = fakeLiveKit([{ identity: 'a', name: 'A' }]);
    await bindRoom(db, 'room-eg', 'org_eg', 'EG');
    await bindRoom(db, 'room-free', 'org_free', 'SA');
    for (const [room, reason] of [
      ['room-eg', 'country_blocked_r3_30'],
      ['room-free', 'plan_has_no_cloud_recording'],
      ['room-unknown', 'no_org'],
    ] as const) {
      const g = await checkCaptureGate(db, lk, room);
      expect(g).toMatchObject({ ok: false, status: 403, body: { reason } });
    }
    expect(await checkCaptureGate(null, lk, 'room-1')).toMatchObject({ ok: false, status: 503 });
  });

  it('enforcePublishGate: undecided and decliners lose publish while capturing, decliners regain it after', async () => {
    await bindRoom(db, 'room-2', 'org_sa', 'SA');
    const lk = fakeLiveKit([
      { identity: 'yes', name: 'Yes', canPublish: true },
      { identity: 'no', name: 'No', canPublish: true },
      { identity: 'new', name: 'New', canPublish: true },
    ]);
    await consent('room-2', 'yes', 'granted', 'org_sa');
    await consent('room-2', 'no', 'declined', 'org_sa');
    expect(await enforcePublishGate(db, lk, 'room-2', true)).toEqual(['no', 'new']);
    expect(Object.fromEntries(lk.perms)).toEqual({ yes: true, no: false, new: false });
    expect(await enforcePublishGate(db, lk, 'room-2', false)).toEqual(['no']);
    expect(Object.fromEntries(lk.perms)).toEqual({ yes: true, no: true, new: false });
  });

  it('latestDecisions returns one row per identity, newest first wins', async () => {
    const rows = await latestDecisions(db, 'room-1', CONSENT_PURPOSE);
    expect(Object.fromEntries(rows.map((r) => [r.identity, r.decision]))).toEqual({
      host: 'granted',
      guest: 'granted',
    });
  });
});

describe('retention lifecycle', () => {
  function fakeStore(
    present: Set<string>,
    failDelete = new Set<string>(),
  ): ObjectStore & { deletes: string[] } {
    const deletes: string[] = [];
    return {
      deletes,
      async head(_b, k) {
        return present.has(k) ? 200 : 404;
      },
      async remove(_b, k) {
        deletes.push(k);
        if (failDelete.has(k)) return 500;
        present.delete(k);
        return 204;
      },
    };
  }

  it('deletes only due recordings, verifies absence, and logs every attempt', async () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const mk = (key: string, startedAt: string, days: number, egress: string) =>
      insertRecording(db, {
        roomId: 'room-1',
        orgId: 'org_ae',
        egressId: egress,
        bucket: 'spenai-recordings',
        objectKey: key,
        startedAt: new Date(startedAt),
        retentionDays: days,
        deleteAfter: new Date(new Date(startedAt).getTime() + days * 86400000),
        consentSnapshot: ['host', 'guest'],
      });
    await mk('due.mp4', '2026-10-01T00:00:00Z', 30, 'EG_1');
    await mk('notdue.mp4', '2026-11-15T00:00:00Z', 30, 'EG_2');
    await mk('gone.mp4', '2026-10-01T00:00:00Z', 30, 'EG_3');
    await mk('stuck.mp4', '2026-10-02T00:00:00Z', 30, 'EG_4');
    const present = new Set(['due.mp4', 'notdue.mp4', 'stuck.mp4']);
    const store = fakeStore(present, new Set(['stuck.mp4']));

    const dry = await runRetention(db, store, { now, runId: 'dry', dryRun: true });
    expect(dry.due).toBe(3);
    expect(store.deletes).toEqual([]);

    const r = await runRetention(db, store, { now, runId: 'run-1' });
    expect(r).toMatchObject({ due: 3, deleted: 1, alreadyAbsent: 1, failed: 1 });
    expect(store.deletes.sort()).toEqual(['due.mp4', 'stuck.mp4']);
    expect(present.has('notdue.mp4')).toBe(true);
    expect(present.has('due.mp4')).toBe(false);

    // failed one stays due; deleted/absent ones are not retried
    const again = await runRetention(db, store, { now, runId: 'run-2' });
    expect(again.due).toBe(1);
    expect(again.items[0].objectKey).toBe('stuck.mp4');

    const log = await deletionExportRows(db, 'org_ae', null, null);
    expect(log.map((l) => [l.object_key, l.outcome, l.run_id])).toEqual([
      ['due.mp4', 'deleted', 'run-1'],
      ['gone.mp4', 'already_absent', 'run-1'],
      ['stuck.mp4', 'failed', 'run-1'],
      ['stuck.mp4', 'failed', 'run-2'],
    ]);
  });
});

describe('consent export', () => {
  it('returns the org rows only, within the window', async () => {
    const rows = await consentExportRows(db, 'org_ae', null, null);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.purpose === CONSENT_PURPOSE)).toBe(true);
    expect(await consentExportRows(db, 'org_eg', null, null)).toEqual([]);
    expect(await consentExportRows(db, 'org_ae', new Date('2100-01-01'), null)).toEqual([]);
    const sa = await consentExportRows(db, 'org_sa', null, null);
    expect(sa.map((r) => r.identity).sort()).toEqual(['no', 'yes']);
  });
});
