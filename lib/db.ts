import { Pool, type QueryResultRow } from 'pg';

/**
 * Camv's own Postgres (WC-CV-3: consent_events, recordings, deletion log).
 * CAMV_DATABASE_URL unset => every caller degrades to "recording not available"
 * (the consent law fails closed for capture, open for the meeting itself).
 */
export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
};

let pool: Pool | null | undefined;

export function getDb(): Queryable | null {
  if (pool !== undefined) return pool;
  const url = process.env.CAMV_DATABASE_URL;
  if (!url) {
    pool = null;
    return pool;
  }
  pool = new Pool({
    connectionString: url,
    max: Number(process.env.CAMV_DATABASE_POOL_MAX ?? 5),
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', () => {
    // idle-client errors are surfaced on the next query; never crash the process
  });
  return pool;
}

/** Test hook: replace (or clear) the process-wide pool. */
export function setDbForTests(db: Queryable | null | undefined) {
  pool = db as Pool | null | undefined;
}
