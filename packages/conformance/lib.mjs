/**
 * CC-68 pure helpers (no I/O): naming, SigV4 presign, verdict, ledger row.
 * Unit-tested by lib.test.mjs; used by cc68-nightly-recording.mjs.
 */
import { createHash, createHmac } from 'node:crypto';

export const HOLD_SECONDS = 60; // CC-68: track egress 60 s
export const DURATION_TOLERANCE_S = 2; // CC-68: ffprobe duration 60 ± 2 s
export const ENDED_WITHIN_S = 120; // CC-68: egress_ended within 120 s of stop
export const MIN_MEAN_VOLUME_DB = -45; // tone is ~ -15 dB; digital silence is -91 dB
export const STREAK_TARGET = 30; // CC-68: 30 consecutive nightly passes
export const KEY_PREFIX = 'conformance/cc68';

/** `syn-YYYYMMDD` for a UTC date; one room per night. */
export function roomForDate(d) {
  return `syn-${d.toISOString().slice(0, 10).replace(/-/g, '')}`;
}

/** Deterministic object keys: one folder per night, so prior nights are read by key, never listed. */
export function keysForRoom(room, publishers) {
  const base = `${KEY_PREFIX}/${room}`;
  return {
    base,
    result: `${base}/result.json`,
    track: Object.fromEntries(publishers.map((p) => [p, `${base}/${p}.ogg`])),
  };
}

export function previousRoom(room) {
  const y = room.slice(4, 8),
    m = room.slice(8, 10),
    d = room.slice(10, 12);
  const t = Date.UTC(Number(y), Number(m) - 1, Number(d)) - 86400000;
  return roomForDate(new Date(t));
}

// ------------------------------------------------------------------ SigV4 (R2, path-style)
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
export const enc = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  );

function scopeKey(cfg, date) {
  return hmac(hmac(hmac(hmac('AWS4' + cfg.secretKey, date), cfg.region), 's3'), 'aws4_request');
}
function target(cfg, key) {
  const u = new URL(cfg.endpoint);
  return {
    host: u.host,
    origin: u.origin,
    path: `/${enc(cfg.bucket)}/${key.split('/').map(enc).join('/')}`,
  };
}

/** Query-signed URL (GET/HEAD) valid for `expires` seconds from `when`. */
export function presign(cfg, method, key, expires, when = new Date()) {
  const amz = when.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const { host, origin, path } = target(cfg, key);
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKey}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = Object.keys(q)
    .sort()
    .map((k) => `${enc(k)}=${enc(q[k])}`)
    .join('&');
  const creq = [method, path, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(creq)].join('\n');
  return `${origin}${path}?${qs}&X-Amz-Signature=${createHmac('sha256', scopeKey(cfg, date)).update(sts).digest('hex')}`;
}

/** Header-signed PUT of a small body (the nightly result.json). */
export function signPut(cfg, key, body, contentType, when = new Date()) {
  const amz = when.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const date = amz.slice(0, 8);
  const { host, origin, path } = target(cfg, key);
  const ph = sha(body);
  const sh = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const creq = [
    'PUT',
    path,
    '',
    `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${ph}\nx-amz-date:${amz}\n`,
    sh,
    ph,
  ].join('\n');
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const sig = createHmac('sha256', scopeKey(cfg, date))
    .update(['AWS4-HMAC-SHA256', amz, scope, sha(creq)].join('\n'))
    .digest('hex');
  return {
    url: origin + path,
    headers: {
      'content-type': contentType,
      'x-amz-date': amz,
      'x-amz-content-sha256': ph,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${sh}, Signature=${sig}`,
    },
  };
}

// ------------------------------------------------------------------ ffprobe / ffmpeg parsing
/** From `ffprobe -print_format json -show_format -show_streams`. */
export function parseProbe(json) {
  const p = typeof json === 'string' ? JSON.parse(json) : json;
  const audio = (p.streams || []).filter((s) => s.codec_type === 'audio');
  const dur = Number(p.format?.duration ?? audio[0]?.duration ?? NaN);
  return {
    durationSec: dur,
    audioStreams: audio.length,
    codec: audio[0]?.codec_name ?? null,
    sampleRate: Number(audio[0]?.sample_rate ?? 0),
  };
}

/** mean_volume from `ffmpeg -af volumedetect` stderr; null when absent. */
export function parseMeanVolume(stderr) {
  const m = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr || '');
  if (!m) return null;
  return m[1] === '-inf' ? -Infinity : Number(m[1]);
}

// ------------------------------------------------------------------ verdict
/**
 * One track's checks. `t` = { egressStatus, error, stoppedAtMs, endedAtMs, bytesEgress,
 * bytesR2, bytesDownloaded, sha256, durationSec, audioStreams, meanVolumeDb }.
 * Returns [{name, pass, detail}].
 */
export function trackChecks(label, t) {
  const c = [];
  const add = (name, pass, detail) =>
    c.push({ name: `${label}: ${name}`, pass: Boolean(pass), detail });
  add(
    'egress complete',
    t.egressStatus === 'EGRESS_COMPLETE' && !t.error,
    `${t.egressStatus}${t.error ? ' · ' + t.error : ''}`,
  );
  const lag = t.endedAtMs && t.stoppedAtMs ? (t.endedAtMs - t.stoppedAtMs) / 1000 : NaN;
  add(
    `egress_ended within ${ENDED_WITHIN_S} s of stop`,
    Number.isFinite(lag) && lag <= ENDED_WITHIN_S,
    `${Number.isFinite(lag) ? lag.toFixed(1) : 'n/a'} s`,
  );
  add(
    'R2 object size == egress size',
    t.bytesR2 > 0 && t.bytesR2 === t.bytesEgress,
    `${t.bytesR2} vs ${t.bytesEgress}`,
  );
  add(
    'signed download complete',
    t.bytesDownloaded > 0 && t.bytesDownloaded === t.bytesR2,
    `${t.bytesDownloaded} B`,
  );
  add(
    'checksum recorded',
    /^[0-9a-f]{64}$/.test(t.sha256 || ''),
    t.sha256 ? `sha256 ${t.sha256.slice(0, 16)}` : 'none',
  );
  const d = t.durationSec;
  add(
    `duration ${HOLD_SECONDS} ± ${DURATION_TOLERANCE_S} s`,
    Number.isFinite(d) && Math.abs(d - HOLD_SECONDS) <= DURATION_TOLERANCE_S,
    `${Number.isFinite(d) ? d.toFixed(2) : 'n/a'} s`,
  );
  add(
    'audio present',
    t.audioStreams >= 1 && t.meanVolumeDb !== null && t.meanVolumeDb > MIN_MEAN_VOLUME_DB,
    `${t.audioStreams} stream(s), mean ${t.meanVolumeDb} dB`,
  );
  return c;
}

export function verdict(checks) {
  const failed = checks.filter((c) => !c.pass);
  return {
    pass: checks.length > 0 && failed.length === 0,
    checks: checks.length,
    failures: failed.length,
    failed: failed.map((c) => c.name),
  };
}

/** Streak = tonight (if pass) + consecutive prior passing nights. `prior` = verdict.pass per previous night, nearest first; null = no record. */
export function streak(tonightPass, prior) {
  if (!tonightPass) return 0;
  let n = 1;
  for (const p of prior) {
    if (p !== true) break;
    n++;
  }
  return n;
}

/** One-line ledger row for docs/cc-status.md (CC-68), from a result object. */
export function ledgerRow(r) {
  const status = r.verdict.pass ? 'pass' : 'FAIL';
  const tracks = r.tracks
    .map(
      (t) =>
        `${t.publisher} ${t.egressId} ${t.durationSec?.toFixed?.(2) ?? 'n/a'} s sha256 \`${(t.sha256 || '').slice(0, 12)}\``,
    )
    .join('; ');
  return `| CC-68 | ${r.room} | ${r.startedAt} | ${status} | ${r.verdict.checks} checks, ${r.verdict.failures} failures | streak ${r.streak}/${STREAK_TARGET} | ${tracks} |`;
}
