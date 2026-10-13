import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hasAdminSecret, parseDateParam, toCsv } from '@/lib/consent/http';
import { consentExportRows, deletionExportRows, getOrg } from '@/lib/consent/repo';
import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

/**
 * GET /api/org/:id/consent-export — WC-CV-3 step 2, CC-70.
 *
 *   ?type=consent   (default) every consent_events row of the org
 *   ?type=deletions the recording deletion log of the org
 *   &from=<ISO>&to=<ISO> optional window (to is exclusive)
 *
 * Auth: server-to-server with x-camv-admin-secret (Passport's Camv admin
 * console proxies it for org admins; R1-CV-PASSPORT). Camv has no org-admin
 * session of its own yet, so the endpoint is never browser-callable directly.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = await checkRateLimit(`consent-export:${clientIp(req.headers)}`, 20, 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }
  if (!hasAdminSecret(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const type = req.nextUrl.searchParams.get('type') ?? 'consent';
  if (type !== 'consent' && type !== 'deletions') {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 });
  }
  const from = parseDateParam(req.nextUrl.searchParams.get('from'));
  const to = parseDateParam(req.nextUrl.searchParams.get('to'));
  if (from === 'invalid' || to === 'invalid') {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'consent_store_unavailable' }, { status: 503 });

  try {
    const org = await getOrg(db, id);
    if (!org) return NextResponse.json({ error: 'org_not_found' }, { status: 404 });

    let csv: string;
    if (type === 'consent') {
      const rows = await consentExportRows(db, id, from, to);
      csv = toCsv(
        [
          'ts',
          'room_id',
          'participant_id',
          'identity',
          'participant_name',
          'purpose',
          'decision',
          'locale',
          'country',
          'text_version',
        ],
        rows.map((r) => [
          r.ts,
          r.room_id,
          r.participant_id,
          r.identity,
          r.participant_name,
          r.purpose,
          r.decision,
          r.locale,
          r.country,
          r.text_version,
        ]),
      );
    } else {
      const rows = await deletionExportRows(db, id, from, to);
      csv = toCsv(
        [
          'logged_at',
          'recording_id',
          'egress_id',
          'bucket',
          'object_key',
          'retention_days',
          'delete_after',
          'run_id',
          'outcome',
          'r2_status',
        ],
        rows.map((r) => [
          r.logged_at,
          r.recording_id,
          r.egress_id,
          r.bucket,
          r.object_key,
          r.retention_days,
          r.delete_after,
          r.run_id,
          r.outcome,
          r.r2_status,
        ]),
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const safeId = id.replace(/[^A-Za-z0-9_-]/g, '_');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="camv-${type}-${safeId}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('consent export failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
