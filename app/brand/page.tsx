import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import { radii, room, tokens, type } from '../../packages/ui/src/brand-tokens';

// UX-T0 Camv slice proof (UX.11 / Q3 UX-T0): token preview — colour roles with computed contrast, buttons, inputs,
// badges, type scale (UX.0.3), room tokens, logo lockups from the pack; EN + AR. Static, noindex, no third-party
// requests; fonts self-hosted (public/fonts). Colours come only from brand-tokens.ts (CSS custom properties).
export const dynamic = 'force-static';
export const metadata: Metadata = {
  title: 'Brand tokens',
  robots: { index: false, follow: false },
};

const PACK = path.join(process.cwd(), 'packages/ui/brand/camv');
const svg = (rel: string) =>
  `data:image/svg+xml;base64,${readFileSync(path.join(PACK, rel)).toString('base64')}`;

function lum(hex: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const pairs: [string, string, string, boolean][] = [
  ['Ink / Mist', tokens.ink, tokens.surface, true],
  ['White / Ink', tokens['surface-alt'], tokens.primary, true],
  ['Slate / Mist', tokens['secondary-text'], tokens.surface, true],
  ['Ink / Coral (accent button)', tokens.ink, tokens.accent, true],
  ['White / Coral (banned for text)', tokens['surface-alt'], tokens.accent, false],
  ['Room text / room bg', room.text, room.bg, true],
];

const css = `
.tp{height:100%;overflow:auto;background:var(--color-surface);color:var(--color-ink);color-scheme:light}
.tp main{max-width:1200px;margin-inline:auto;padding:2rem 1.25rem 4rem}
.tp [lang=ar]{font-family:var(--camv-font-ar)}
.tp [lang=ar] .body{line-height:${type.scale.body.arLine}}
.tp h2{font-size:${type.scale.h3.size};line-height:${type.scale.h3.line};font-weight:${type.weights.heading};margin:2.5rem 0 1rem}
.tp .row{display:flex;flex-wrap:wrap;gap:1rem;align-items:center}
.tp .sw{width:168px;border:1px solid var(--color-border);border-radius:var(--radius-md);overflow:hidden;background:var(--color-surface-alt)}
.tp .sw div{height:64px}
.tp .sw p{margin:0;padding:.5rem .75rem;font-size:${type.scale['body-sm'].size};line-height:${type.scale['body-sm'].line}}
.tp .card{background:var(--color-surface-alt);border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:1.5rem}
.tp button{font:inherit;font-weight:${type.weights.heading};border-radius:var(--radius-md);padding-inline:1.25rem;border:1px solid transparent;cursor:pointer}
.tp button:focus-visible,.tp input:focus-visible{outline:2px solid var(--color-info);outline-offset:2px}
.tp .b-primary{background:var(--color-primary);color:var(--color-surface-alt)}
.tp .b-accent{background:var(--color-accent);color:var(--color-ink)}
.tp .b-secondary{background:transparent;color:var(--color-primary);border-color:var(--color-primary)}
.tp .b-danger{background:var(--color-danger);color:var(--color-surface-alt)}
.tp .lg{height:52px}.tp .md{height:44px}
.tp label span{display:block;font-weight:${type.weights.heading};margin-block-end:.25rem}
.tp input{font:inherit;height:44px;padding-inline:.75rem;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface-alt);color:var(--color-ink);width:260px}
.tp input[aria-invalid=true]{border-color:var(--color-danger)}
.tp input:disabled{opacity:.55}
.tp .hint{font-size:${type.scale.caption.size};line-height:${type.scale.caption.line};color:var(--color-secondary-text);margin:.25rem 0 0}
.tp .err{color:var(--color-danger)}
.tp .badge{display:inline-block;font-size:${type.scale.caption.size};line-height:${type.scale.caption.line};letter-spacing:.02em;font-weight:${type.weights.heading};padding:.25rem .75rem;border-radius:var(--radius-full);color:var(--color-surface-alt)}
.tp .room{background:var(--room-bg);color:var(--room-text);border-radius:var(--radius-lg);padding:1.5rem}
.tp .tile{width:200px;height:120px;background:var(--room-tiles);border-radius:var(--radius-tile);display:grid;place-items:center;border:3px solid transparent}
.tp .tile.speaking{border-color:var(--room-speaking-ring)}
.tp .ctl{width:52px;height:52px;border-radius:var(--radius-full);background:var(--room-controls);display:grid;place-items:center}
.tp .ctl.leave{background:var(--color-accent)}
.tp table{border-collapse:collapse;font-size:${type.scale['body-sm'].size}}
.tp td,.tp th{border-bottom:1px solid var(--color-border);padding:.5rem .75rem;text-align:start}
.tp .num{font-variant-numeric:tabular-nums}
@media (max-width:600px){.tp .disp{font-size:2.25rem!important}}
`;

const steps = ['display', 'h1', 'h2', 'h3', 'h4', 'body', 'body-sm', 'caption'] as const;

const COPY = {
  en: {
    hero: 'Meet without friction.',
    join: 'Join meeting',
    start: 'Start a meeting',
    save: 'Save',
    cancel: 'Cancel',
    del: 'Delete',
    name: 'Your name',
    email: 'Email',
    req: 'Required',
    badge: {
      success: 'Saved',
      info: 'Copied',
      warning: 'Something needs attention',
      danger: 'Try again',
    },
    perm: 'Your browser will ask for camera and microphone access.',
  },
  ar: {
    hero: 'اجتمع بلا عوائق.',
    join: 'انضم إلى الاجتماع',
    start: 'ابدأ اجتماعاً',
    save: 'حفظ',
    cancel: 'إلغاء',
    del: 'حذف',
    name: 'اسمك',
    email: 'البريد الإلكتروني',
    req: 'مطلوب',
    badge: {
      success: 'تم الحفظ',
      info: 'تم النسخ',
      warning: 'يوجد ما يحتاج انتباهك',
      danger: 'حاول مجدداً',
    },
    perm: 'سيطلب المتصفح إذن الكاميرا والميكروفون.',
  },
} as const;

function Controls({ l }: { l: 'en' | 'ar' }) {
  const L = COPY[l];
  return (
    <div className="card" lang={l} dir={l === 'ar' ? 'rtl' : 'ltr'}>
      <p
        className="disp"
        style={{
          fontSize: type.scale.display.size,
          lineHeight: type.scale.display.line,
          fontWeight: type.weights.heading,
          margin: '0 0 1rem',
        }}
      >
        {L.hero}
      </p>
      <div className="row">
        <button className="b-accent lg">{L.join}</button>
        <button className="b-primary md">{L.start}</button>
        <button className="b-secondary md">{L.cancel}</button>
        <button className="b-primary md">{L.save}</button>
        <button className="b-danger md">{L.del}</button>
      </div>
      <div className="row" style={{ marginBlockStart: '1.5rem', alignItems: 'flex-start' }}>
        <label>
          <span>{L.name}</span>
          <input dir="auto" defaultValue={l === 'ar' ? 'سارة' : 'Sarah'} />
        </label>
        <label>
          <span>{L.email}</span>
          <input dir="auto" type="email" aria-invalid="true" placeholder="you@company.com" />
          <p className="hint err">{L.req}</p>
        </label>
        <label>
          <span>{L.name}</span>
          <input dir="auto" disabled defaultValue="Camv" />
        </label>
      </div>
      <div className="row" style={{ marginBlockStart: '1.5rem' }}>
        {(['success', 'info', 'warning', 'danger'] as const).map((k) => (
          <span key={k} className="badge" style={{ background: `var(--color-${k})` }}>
            {L.badge[k]}
          </span>
        ))}
      </div>
      <p className="body" style={{ marginBlockEnd: 0, color: 'var(--color-secondary-text)' }}>
        {L.perm}
      </p>
    </div>
  );
}

export default function BrandTokens() {
  return (
    <div className="tp">
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <main>
        <header className="row" style={{ justifyContent: 'space-between' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={svg('logo/svg/camv-logo-primary.svg')} alt="Camv" height={40} />
          <span className="hint">brand_camv_v1 · UX.1.3 · UX-T0</span>
        </header>

        <h2>Colour roles</h2>
        <div className="row">
          {Object.entries(tokens).map(([k, v]) => (
            <div className="sw" key={k}>
              <div style={{ background: `var(--color-${k})` }} />
              <p>
                <b>{k}</b>
                <br />
                <span className="num" dir="ltr">
                  {v}
                </span>
              </p>
            </div>
          ))}
        </div>
        <table style={{ marginBlockStart: '1.25rem' }}>
          <thead>
            <tr>
              <th>Pair</th>
              <th>Ratio (computed)</th>
              <th>Use</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map(([label, fg, bg, ok]) => {
              const x = ratio(fg, bg);
              return (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="num">{x.toFixed(2)}:1</td>
                  <td>
                    {ok ? (x >= 4.5 ? 'text — AA pass' : 'FAIL') : 'icons ≥ 24 px only, never text'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2>Components · English</h2>
        <Controls l="en" />
        <h2 lang="ar" dir="rtl">
          المكوّنات · العربية
        </h2>
        <Controls l="ar" />

        <h2>Room tokens (dark, UX.6 room only)</h2>
        <div className="room">
          <div className="row">
            <div className="tile speaking">Sarah</div>
            <div className="tile">Omar</div>
          </div>
          <div className="row" style={{ marginBlockStart: '1rem' }}>
            <div className="ctl" aria-label="Mute">
              ●
            </div>
            <div className="ctl" aria-label="Camera">
              ■
            </div>
            <div className="ctl leave" aria-label="Leave" />
          </div>
          <div className="row" style={{ marginBlockStart: '1rem' }}>
            {Object.entries(room).map(([k, v]) => (
              <span key={k} className="hint num" style={{ color: 'var(--room-text)' }} dir="ltr">
                {k} {v}
              </span>
            ))}
          </div>
        </div>

        <h2>
          Type scale (UX.0.3) · {type.latin} + {type.arabic}
        </h2>
        {steps.map((s) => (
          <div key={s} className="row" style={{ alignItems: 'baseline', marginBlockEnd: '.5rem' }}>
            <span className="hint num" style={{ width: 150 }} dir="ltr">
              {s} {type.scale[s].size} / {type.scale[s].line}
            </span>
            <span
              style={{
                fontSize: type.scale[s].size,
                lineHeight: type.scale[s].line,
                fontWeight:
                  s.startsWith('h') || s === 'display' ? type.weights.heading : type.weights.body,
              }}
            >
              Meet without friction.
            </span>
            <span
              lang="ar"
              dir="rtl"
              style={{
                fontSize: type.scale[s].size,
                lineHeight:
                  'arLine' in type.scale[s]
                    ? (type.scale[s] as { arLine: number }).arLine
                    : type.scale[s].line,
                fontWeight:
                  s.startsWith('h') || s === 'display' ? type.weights.heading : type.weights.body,
              }}
            >
              اجتمع بلا عوائق.
            </span>
          </div>
        ))}

        <h2>Logo system (as delivered)</h2>
        <div className="row">
          {['camv-logo-primary', 'camv-logo-mono-ink', 'camv-emblem-master'].map((n) => (
            <div key={n} className="card" style={{ padding: '1rem' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svg(`logo/svg/${n}.svg`)} alt={n} height={40} />
              <p className="hint">{n}.svg</p>
            </div>
          ))}
          {['camv-logo-reverse', 'camv-logo-mono-white'].map((n) => (
            <div
              key={n}
              className="card"
              style={{ padding: '1rem', background: 'var(--color-primary)' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={svg(`logo/svg/${n}.svg`)} alt={n} height={40} />
              <p className="hint" style={{ color: 'var(--color-surface)' }}>
                {n}.svg
              </p>
            </div>
          ))}
        </div>
        <p className="hint">
          Radii:{' '}
          {Object.entries(radii)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')}
        </p>
      </main>
    </div>
  );
}
