/**
 * Camv brand tokens — UX-T0 Camv slice (Bible v12.6 UX.1.3 "Human Alignment", Brand v1.0).
 *
 * `tokens`, `room`, `radii`, `type` are UX.1.3 transcribed value for value, by the names UX.1.3 uses. The delivered
 * pack (`brand_camv_v1.zip`) is committed unchanged under packages/ui/brand/camv/ (per-file sha256 in
 * packages/ui/brand/camv.sha256, checked by lib/brandTokens.test.ts, which also pins every value below to UX.1.3).
 *
 * This is the only source file allowed to contain hex colour literals (UX.0.10; scripts/check-no-hex.mjs).
 * The app reads colours as CSS custom properties: app/layout.tsx renders `cssVariables()` into <head>, and
 * styles/*.css use `var(--camv-*)` / `var(--color-*)` only.
 */

/** UX.1.3 colour roles, verbatim. */
export const tokens = {
  primary: '#102A5C', // Camv Ink — wordmark, headings, dark surfaces, nav
  accent: '#F06C62', // Camv Coral — "Join", presence dots, selective CTAs; carries Ink text, never white text
  'secondary-text': '#536174', // Camv Slate
  surface: '#F5F7FA', // Camv Mist
  'surface-alt': '#FFFFFF',
  ink: '#102A5C',
  border: '#DDE3EC',
  success: '#1F8A5B',
  warning: '#B7791F',
  danger: '#B42318', // distinct from Coral
  info: '#102A5C',
} as const;

/** UX.1.3 room tokens (dark) — UX.6 meeting room only. */
export const room = {
  bg: '#0B1B3A',
  tiles: '#13264C',
  controls: '#1B335F',
  text: '#F5F7FA',
  'speaking-ring': '#7FD1B9',
} as const;

/** UX.1.3 radii (px). */
export const radii = { sm: 6, md: 8, lg: 12, tile: 12, full: 999 } as const;

/** UX.1.3 typeface + UX.2.3 Arabic companion; UX.0.3 scale (rem / line-height). */
export const type = {
  latin: 'Noto Sans',
  arabic: 'Noto Sans Arabic',
  weights: { body: 400, heading: 700 },
  scale: {
    display: { size: '3.5rem', line: 1.05 },
    h1: { size: '2.25rem', line: 1.15 },
    h2: { size: '1.75rem', line: 1.2 },
    h3: { size: '1.375rem', line: 1.3 },
    h4: { size: '1.125rem', line: 1.4 },
    body: { size: '1rem', line: 1.6, arLine: 1.75 },
    'body-sm': { size: '0.875rem', line: 1.5, arLine: 1.65 },
    caption: { size: '0.75rem', line: 1.4 },
  },
} as const;

/**
 * Not UX.1: the LiveKit prefab ramp the live room already uses (bg2..bg5, fg3/fg4, hover/pressed states), moved
 * here unchanged so no other file carries a hex literal. No visual change in this slice; the room moves to the
 * UX.1.3 `room` tokens with the UX.6.5 page book (UX-T2), which retires this block.
 */
export const derived = {
  'ink-hover': '#16346F',
  'coral-hover': '#E0564C',
  'coral-pressed': '#D1483F',
  'coral-pressed-2': '#B93A32',
  'lk-bg2': '#17356E',
  'lk-bg3': '#1D3F80',
  'lk-bg4': '#234A92',
  'lk-bg5': '#2955A4',
  'lk-fg3': '#E3E8EF',
  'lk-fg4': '#CFD6E0',
} as const;

/** Self-hosted faces (public/fonts): Noto Sans woff2 converted from the pack's TTFs; Arabic companion woff2 (OFL). */
export const fontFaces = [
  { family: type.latin, src: '/fonts/NotoSans-400.woff2', weight: 400 },
  { family: type.latin, src: '/fonts/NotoSans-700.woff2', weight: 700 },
  { family: type.arabic, src: '/fonts/NotoSansArabic-400.woff2', weight: 400 },
  { family: type.arabic, src: '/fonts/NotoSansArabic-700.woff2', weight: 700 },
] as const;

export const fontStacks = {
  latin: `'${type.latin}', '${type.arabic}', system-ui, -apple-system, sans-serif`,
  arabic: `'${type.arabic}', '${type.latin}', Tahoma, sans-serif`,
} as const;

/**
 * Custom properties for :root. `--color-<role>` and `--room-<name>` mirror the token names; the `--camv-*` names
 * are the ones styles/globals.css already used (kept so the live room renders identically).
 */
export function cssVariables(): string {
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(tokens)) v[`--color-${k}`] = val;
  for (const [k, val] of Object.entries(room)) v[`--room-${k}`] = val;
  for (const [k, val] of Object.entries(radii)) v[`--radius-${k}`] = `${val}px`;
  Object.assign(v, {
    '--camv-ink': tokens.primary,
    '--camv-coral': tokens.accent,
    '--camv-slate': tokens['secondary-text'],
    '--camv-mist': tokens.surface,
    '--camv-white': tokens['surface-alt'],
    '--camv-ink-hover': derived['ink-hover'],
    '--camv-coral-hover': derived['coral-hover'],
    '--camv-coral-pressed': derived['coral-pressed'],
    '--camv-coral-pressed-2': derived['coral-pressed-2'],
    '--camv-lk-bg2': derived['lk-bg2'],
    '--camv-lk-bg3': derived['lk-bg3'],
    '--camv-lk-bg4': derived['lk-bg4'],
    '--camv-lk-bg5': derived['lk-bg5'],
    '--camv-lk-fg3': derived['lk-fg3'],
    '--camv-lk-fg4': derived['lk-fg4'],
    '--camv-font': fontStacks.latin,
    '--camv-font-ar': fontStacks.arabic,
  });
  return Object.entries(v)
    .map(([k, val]) => `${k}:${val}`)
    .join(';');
}

/** The <head> stylesheet: @font-face for every self-hosted face + :root custom properties. */
export function brandStylesheet(): string {
  const faces = fontFaces
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';src:url(${f.src}) format('woff2');font-weight:${f.weight};font-style:normal;font-display:swap}`,
    )
    .join('');
  return `${faces}:root{${cssVariables()}}`;
}

export type TokenName = keyof typeof tokens;
