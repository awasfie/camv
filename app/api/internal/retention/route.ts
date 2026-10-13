import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hasAdminSecret } from '@/lib/consent/http';
import { runRetention } from '@/lib/consent/retention';
import { r2ConfigFromEnv, r2Store } from '@/lib/r2';

/**
 * POST /api/internal/retention?dryRun=1 — WC-CV-3 step 2 retention lifecycle.
 * Run daily by the Coolify scheduled task on the camv app (see
 * docs/runbooks/camv-consent-retention.md). Admin secret (x-camv-admin-secret) only.
 */
export async function POST(req: NextRequest) {
  if (!hasAdminSecret(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getDb();
  const cfg = r2ConfigFromEnv();
  if (!db || !cfg) {
    return NextResponse.json({ error: 'not_configured', db: !!db, r2: !!cfg }, { status: 503 });
  }
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
  const runId = `ret-${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;
  try {
    const result = await runRetention(db, r2Store(cfg), { runId, dryRun });
    console.log(
      `retention ${runId} dryRun=${dryRun} due=${result.due} deleted=${result.deleted} ` +
        `absent=${result.alreadyAbsent} failed=${result.failed}`,
    );
    return NextResponse.json(result, { status: result.failed > 0 ? 207 : 200 });
  } catch (e) {
    console.error('retention run failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal_error', runId }, { status: 500 });
  }
}
