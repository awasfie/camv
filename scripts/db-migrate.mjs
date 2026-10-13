#!/usr/bin/env node
/**
 * Camv schema migrations (WC-CV-3 onward).
 *
 *   CAMV_DATABASE_URL=... node scripts/db-migrate.mjs            # dry run: list pending
 *   CAMV_DATABASE_URL=... node scripts/db-migrate.mjs --apply    # apply pending
 *
 * Each db/migrations/NNNN_*.sql file runs once, inside one transaction, and is
 * recorded in camv_schema_migrations with its sha256. A recorded file whose
 * contents changed aborts the run (never silently re-applied). Migrations must
 * be additive (D-R70 70-6); the script refuses files containing DROP TABLE,
 * DROP COLUMN, TRUNCATE or DELETE FROM.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const apply = process.argv.includes('--apply');
const url = process.env.CAMV_DATABASE_URL;
if (!url) {
  console.error('CAMV_DATABASE_URL is not set');
  process.exit(2);
}

const FORBIDDEN = /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b/i;

const files = readdirSync(dir)
  .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
  .sort();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS camv_schema_migrations (
    filename   text PRIMARY KEY,
    sha256     text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const { rows } = await client.query('SELECT filename, sha256 FROM camv_schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename, r.sha256]));

  const pending = [];
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    if (applied.has(f)) {
      if (applied.get(f) !== sha) {
        throw new Error(
          `${f} was applied with sha256 ${applied.get(f)} but now hashes ${sha}; add a new migration instead`,
        );
      }
      continue;
    }
    const code = sql.replace(/--.*$/gm, '');
    if (FORBIDDEN.test(code))
      throw new Error(`${f} contains a destructive statement; migrations are additive only`);
    pending.push({ f, sql, sha });
  }

  console.log(
    `applied=${applied.size} pending=${pending.length}${pending.length ? ' ' + pending.map((p) => p.f).join(',') : ''}`,
  );
  if (!apply) {
    console.log('dry run (pass --apply to run)');
  } else {
    for (const { f, sql, sha } of pending) {
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO camv_schema_migrations (filename, sha256) VALUES ($1, $2)',
          [f, sha],
        );
        await client.query('COMMIT');
        console.log(`applied ${f} ${sha.slice(0, 12)}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`${f} failed and was rolled back: ${e.message}`);
      }
    }
  }
} finally {
  await client.end();
}
