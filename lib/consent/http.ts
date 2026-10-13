import { timingSafeEqual } from 'crypto';

/**
 * Server-to-server auth for the admin routes (org upsert, consent export,
 * retention run) with CAMV_ADMIN_SECRET in x-camv-admin-secret. Deliberately NOT
 * CAMV_INTERNAL_SECRET: that one is shared with Timeway, and the export carries
 * participant personal data Timeway has no reason to read.
 */
export function hasAdminSecret(headers: Headers): boolean {
  const expected = process.env.CAMV_ADMIN_SECRET;
  const got = headers.get('x-camv-admin-secret');
  if (!expected || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** RFC 4180 CSV with spreadsheet-formula neutralisation. */
export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function parseDateParam(v: string | null): Date | null | 'invalid' {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}
