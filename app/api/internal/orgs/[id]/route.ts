import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { hasAdminSecret } from '@/lib/consent/http';
import { upsertOrg } from '@/lib/orgs/upsert';

/**
 * PUT /api/internal/orgs/:id — upsert Camv's projection of a Passport org
 * (id = Passport organization id) and the booking-host emails that map to it.
 * Server-to-server only (x-camv-admin-secret): Passport provisioning
 * (R1-CV-PASSPORT) and ops. Body:
 *   { name?, country?, plan, recordingRetentionDays?, recordingEnabled?, hostEmails?: string[],
 *     vertical?, handlesPhi?, residencyCell? }
 * hostEmails is additive: emails are added or re-pointed to this org, never removed.
 * vertical/handlesPhi/residencyCell (WC-PE-15f2): absent = keep the stored value. A clinic
 * org (vertical 'clinic' or handlesPhi true) must pass the @family/residency guard against
 * this deployment's RESIDENCY_CELL, else 422 { error: residency_cell_* } and nothing is written.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasAdminSecret(req.headers)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  try {
    const r = await upsertOrg(getDb(), id, body);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error('org upsert failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
