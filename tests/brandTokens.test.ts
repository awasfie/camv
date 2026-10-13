// UX-T0 Camv slice: the token file equals UX.1.3 (Bible v12.6) and the delivered pack is committed unchanged.
// Expected values are typed here from UX.1.3, independently of packages/ui/src/brand-tokens.ts, so a drift in
// either fails. (tests/ is outside the no-hex scan roots: this file is the comparison, not product code.)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  brandStylesheet,
  fontFaces,
  radii,
  room,
  tokens,
  type,
} from '../packages/ui/src/brand-tokens';

const repo = join(__dirname, '..');

describe('brand-tokens.ts = UX.1.3 Camv', () => {
  it('colour roles', () => {
    expect(tokens).toStrictEqual({
      primary: '#102A5C',
      accent: '#F06C62',
      'secondary-text': '#536174',
      surface: '#F5F7FA',
      'surface-alt': '#FFFFFF',
      ink: '#102A5C',
      border: '#DDE3EC',
      success: '#1F8A5B',
      warning: '#B7791F',
      danger: '#B42318',
      info: '#102A5C',
    });
  });
  it('room tokens (dark)', () => {
    expect(room).toStrictEqual({
      bg: '#0B1B3A',
      tiles: '#13264C',
      controls: '#1B335F',
      text: '#F5F7FA',
      'speaking-ring': '#7FD1B9',
    });
  });
  it('radii, typeface, Arabic companion', () => {
    expect(radii).toStrictEqual({ sm: 6, md: 8, lg: 12, tile: 12, full: 999 });
    expect(type.latin).toBe('Noto Sans');
    expect(type.arabic).toBe('Noto Sans Arabic');
    expect(type.weights).toStrictEqual({ body: 400, heading: 700 });
  });
  it('contrast pairs UX.1.3 states (computed, WCAG 2.x)', () => {
    const lum = (h: string) => {
      const c = [1, 3, 5]
        .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    expect(ratio(tokens.ink, tokens.surface)).toBeGreaterThanOrEqual(12.95); // 13.0:1
    expect(ratio(tokens['surface-alt'], tokens.primary)).toBeGreaterThanOrEqual(13.85); // 13.9:1
    expect(ratio(tokens['secondary-text'], tokens.surface)).toBeGreaterThanOrEqual(5.85); // 5.9:1
    expect(ratio(tokens.ink, tokens.accent)).toBeGreaterThanOrEqual(4.5); // 4.7:1 — Coral carries Ink text
    expect(ratio(tokens['surface-alt'], tokens.accent)).toBeLessThan(4.5); // 3.0:1 — white on Coral banned
  });
  it('stylesheet carries every face and role', () => {
    const css = brandStylesheet();
    for (const f of fontFaces) expect(css).toContain(f.src);
    for (const [k, v] of Object.entries(tokens)) expect(css).toContain(`--color-${k}:${v}`);
    for (const [k, v] of Object.entries(room)) expect(css).toContain(`--room-${k}:${v}`);
  });
});

describe('pack committed as delivered (brand_camv_v1.zip)', () => {
  const dir = join(repo, 'packages/ui/brand/camv');
  const manifest = readFileSync(join(repo, 'packages/ui/brand/camv.sha256'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split('  ') as [string, string]);
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) =>
      statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)],
    );

  it('every file matches its sha256 and nothing is added', () => {
    const files = walk(dir)
      .map((f) => relative(dir, f))
      .sort();
    expect(files).toStrictEqual(manifest.map(([, p]) => p).sort());
    for (const [sum, p] of manifest) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, p)))
          .digest('hex'),
        p,
      ).toBe(sum);
    }
  });
  it('self-hosted faces exist with their OFL', () => {
    for (const f of fontFaces)
      expect(statSync(join(repo, 'public', f.src)).size).toBeGreaterThan(10_000);
    expect(readFileSync(join(repo, 'public/fonts/NotoSans-OFL.txt'), 'utf8')).toContain(
      'SIL Open Font License',
    );
    expect(readFileSync(join(repo, 'public/fonts/NotoSansArabic-OFL.txt'), 'utf8')).toContain(
      'SIL Open Font License',
    );
  });
});
