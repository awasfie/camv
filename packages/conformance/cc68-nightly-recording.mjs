#!/usr/bin/env node
/**
 * CC-68 (Bible v12.6, WC-CV-5): nightly synthetic recording — CC-21 made recurring.
 *
 *   room `syn-<YYYYMMDD>` → two headless publishers → one track egress per publisher
 *   (audio track, 60 s) → egress ended → signed R2 URL → full download → ffprobe
 *   duration 60 ± 2 s, audio present (mean volume above silence) → sha256 stored.
 *   Pass also needs egress ended within 120 s of stop. Any failure pages the Q-OB
 *   Telegram route (the G3 n8n webhook) within the same run.
 *
 *   node packages/conformance/cc68-nightly-recording.mjs run      nightly run (writes: egress jobs, R2 objects)
 *   node packages/conformance/cc68-nightly-recording.mjs verify <syn-YYYYMMDD>
 *                                                                  read-only re-check of a stored night (auditor)
 *   node packages/conformance/cc68-nightly-recording.mjs ledger [n] last n nights' rows for docs/cc-status.md (read-only)
 *
 * Storage: s3://$RECORDING_S3_BUCKET/conformance/cc68/<room>/{<publisher>.ogg,result.json}.
 * Keys are deterministic per night, so the streak is read by key (GET), never by listing.
 * The camv retention job only deletes keys held in camv_recordings, so this prefix is not swept.
 * Nothing here deletes anything.
 *
 * "egress_ended": the run polls EgressInfo until status ≥ COMPLETE and takes `endedAt`
 * — the same EgressInfo the LiveKit `egress_ended` webhook carries — so the check does
 * not depend on a webhook receiver being reachable from the runner.
 *
 * Env (camv app env, D-R51): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
 *   RECORDING_S3_ENDPOINT, RECORDING_S3_BUCKET, RECORDING_S3_ACCESS_KEY,
 *   RECORDING_S3_SECRET_KEY, RECORDING_S3_REGION (default auto).
 *   Optional: CC68_ALERT_URL (default the G3 webhook), CC68_NO_PAGE=1 (dev runs),
 *   CC68_ROOM (override room name; dev only), HOLD_SECONDS (dev only; a pass needs 60).
 * Needs ffprobe + ffmpeg on PATH and the deps in this folder's package.json.
 * Exit: 0 = pass · 1 = fail (paged) · 2 = could not run (paged).
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HOLD_SECONDS,
  ENDED_WITHIN_S,
  STREAK_TARGET,
  roomForDate,
  keysForRoom,
  previousRoom,
  presign,
  signPut,
  parseProbe,
  parseMeanVolume,
  trackChecks,
  verdict,
  streak,
  ledgerRow,
} from './lib.mjs';

const E = process.env;
const MODE = process.argv[2];
const ALERT_URL = E.CC68_ALERT_URL || 'https://n8n.awstreams.chat/webhook/g3-alert';
const HOLD = Number(E.HOLD_SECONDS ?? HOLD_SECONDS);
const PUBLISHERS = [
  { id: 'pub-a', hz: 440 },
  { id: 'pub-b', hz: 660 },
];
const REQ = [
  'LIVEKIT_URL',
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'RECORDING_S3_ENDPOINT',
  'RECORDING_S3_BUCKET',
  'RECORDING_S3_ACCESS_KEY',
  'RECORDING_S3_SECRET_KEY',
];
const cfg = () => ({
  endpoint: E.RECORDING_S3_ENDPOINT,
  bucket: E.RECORDING_S3_BUCKET,
  accessKey: E.RECORDING_S3_ACCESS_KEY,
  secretKey: E.RECORDING_S3_SECRET_KEY,
  region: E.RECORDING_S3_REGION || 'auto',
});
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const httpsLk = () => {
  const u = new URL(E.LIVEKIT_URL);
  u.protocol = 'https:';
  return u.origin;
};
const STATUS = [
  'EGRESS_STARTING',
  'EGRESS_ACTIVE',
  'EGRESS_ENDING',
  'EGRESS_COMPLETE',
  'EGRESS_FAILED',
  'EGRESS_ABORTED',
  'EGRESS_LIMIT_REACHED',
];

async function page(title, message) {
  if (E.CC68_NO_PAGE === '1') {
    console.log(`PAGE (suppressed, CC68_NO_PAGE=1): ${title} — ${message}`);
    return;
  }
  try {
    const r = await fetch(ALERT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        emoji: '🔴',
        title,
        message,
        source: 'cc68-nightly-recording',
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(20000),
    });
    console.log(`PAGE sent: HTTP ${r.status}`);
  } catch (err) {
    console.log(`PAGE failed: ${err.message}`);
  }
}

async function couldNotRun(room, msg) {
  console.log(`COULD NOT RUN — ${msg}`);
  await page(`CC-68 nightly recording could not run (${room})`, msg);
  process.exit(2);
}

async function getJson(key) {
  const r = await fetch(presign(cfg(), 'GET', key, 300), { signal: AbortSignal.timeout(30000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${key} → ${r.status}`);
  return r.json();
}

/** HEAD size, full signed download, sha256, ffprobe, mean volume. */
async function inspect(key) {
  const head = await fetch(presign(cfg(), 'HEAD', key, 300), {
    method: 'HEAD',
    signal: AbortSignal.timeout(30000),
  });
  const bytesR2 = head.ok ? Number(head.headers.get('content-length') || 0) : 0;
  const url = presign(cfg(), 'GET', key, 3600);
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const out = {
    bytesR2,
    signedStatus: res.status,
    bytesDownloaded: buf.length,
    sha256: buf.length ? createHash('sha256').update(buf).digest('hex') : null,
    durationSec: NaN,
    audioStreams: 0,
    meanVolumeDb: null,
  };
  if (!buf.length) return out;
  const dir = mkdtempSync(join(tmpdir(), 'cc68-'));
  try {
    const file = join(dir, 'track.ogg');
    writeFileSync(file, buf);
    Object.assign(
      out,
      parseProbe(
        execFileSync(
          'ffprobe',
          ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
          { encoding: 'utf8' },
        ),
      ),
    );
    const vol = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-i',
        file,
        '-map',
        '0:a:0',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    ).stderr;
    out.meanVolumeDb = parseMeanVolume(vol);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

async function priorPasses(room, n) {
  const out = [];
  if (!/^syn-\d{8}$/.test(room)) return out; // dev rooms carry no streak
  let r = room;
  for (let i = 0; i < n; i++) {
    r = previousRoom(r);
    let j = null;
    try {
      j = await getJson(keysForRoom(r, []).result);
    } catch {
      j = null;
    }
    out.push(j ? j.verdict?.pass === true : null);
    if (out[out.length - 1] !== true) break;
  }
  return out;
}

function report(checks) {
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name} — ${c.detail}`);
}

// ------------------------------------------------------------------ run (writes)
async function run() {
  const startedAt = new Date().toISOString();
  const room = E.CC68_ROOM || roomForDate(new Date());
  const missing = REQ.filter((k) => !E[k]);
  if (missing.length) return couldNotRun(room, `missing env ${missing.join(', ')}`);
  for (const bin of ['ffprobe', 'ffmpeg']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
    } catch {
      return couldNotRun(room, `${bin} not on PATH`);
    }
  }
  console.log(`CC-68 run · room ${room} · hold ${HOLD} s · ${startedAt}`);
  const keys = keysForRoom(
    room,
    PUBLISHERS.map((p) => p.id),
  );

  let sdk, lk;
  try {
    sdk = await import('livekit-server-sdk');
    lk = await import('@livekit/rtc-node');
  } catch (err) {
    return couldNotRun(room, `deps: ${err.message} (run npm ci in packages/conformance)`);
  }
  const { AccessToken, EgressClient, DirectFileOutput, S3Upload, TrackSource } = sdk;
  const eg = new EgressClient(httpsLk(), E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET);

  const pubs = [];
  const tracks = [];
  let fatal = null;
  try {
    // 1) two headless publishers, each a distinct tone on its own audio track
    for (const p of PUBLISHERS) {
      const at = new AccessToken(E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET, {
        identity: `cc68-${p.id}`,
        ttl: '10m',
      });
      at.addGrant({
        room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: false,
        canPublishSources: [TrackSource.MICROPHONE],
      });
      const r = new lk.Room();
      await r.connect(E.LIVEKIT_URL, await at.toJwt(), { autoSubscribe: false, dynacast: false });
      const src = new lk.AudioSource(48000, 1);
      const opt = new lk.TrackPublishOptions();
      opt.source = lk.TrackSource.SOURCE_MICROPHONE;
      const pub = await r.localParticipant.publishTrack(
        lk.LocalAudioTrack.createAudioTrack(`cc68-${p.id}-tone`, src),
        opt,
      );
      const state = { p, r, src, stop: false, phase: 0, trackSid: pub.sid };
      state.loop = (async () => {
        while (!state.stop) {
          const d = new Int16Array(480);
          for (let i = 0; i < 480; i++) {
            d[i] = Math.round(Math.sin(state.phase) * 8000);
            state.phase += (2 * Math.PI * p.hz) / 48000;
          }
          await src.captureFrame(new lk.AudioFrame(d, 48000, 1, 480));
        }
      })();
      pubs.push(state);
      console.log(`publisher ${p.id} joined, track ${pub.sid} (${p.hz} Hz)`);
    }
    await sleep(2000);

    // 2) one track egress per publisher, straight to R2; the hold runs from the first start call
    const t0 = Date.now();
    for (const s of pubs) {
      const out = new DirectFileOutput({
        filepath: keys.track[s.p.id],
        output: {
          case: 's3',
          value: new S3Upload({
            endpoint: E.RECORDING_S3_ENDPOINT,
            accessKey: E.RECORDING_S3_ACCESS_KEY,
            secret: E.RECORDING_S3_SECRET_KEY,
            region: E.RECORDING_S3_REGION || 'auto',
            bucket: E.RECORDING_S3_BUCKET,
            forcePathStyle: true,
          }),
        },
      });
      const info = await eg.startTrackEgress(room, out, s.trackSid);
      tracks.push({
        publisher: s.p.id,
        egressId: info.egressId,
        key: keys.track[s.p.id],
        trackSid: s.trackSid,
      });
      console.log(`track egress ${info.egressId} · ${s.p.id} · ${keys.track[s.p.id]}`);
    }
    // hold = HOLD s of recorded media: wait for EGRESS_ACTIVE, then stop HOLD s after the egress's own startedAt
    for (const t of tracks) {
      for (let i = 0; i < 60; i++) {
        const [e] = await eg.listEgress({ egressId: t.egressId });
        if (e && e.status >= 1 && e.startedAt) {
          t.startedAtMs = Number(e.startedAt / 1000000n);
          break;
        }
        await sleep(500);
      }
    }
    const startMs = Math.max(...tracks.map((t) => t.startedAtMs || t0));
    await sleep(Math.max(0, startMs + HOLD * 1000 - Date.now()));
    for (const t of tracks) {
      t.stoppedAtMs = Date.now();
      await eg.stopEgress(t.egressId).catch((err) => {
        t.stopError = err.message;
      });
    }

    // 3) egress ended → EgressInfo.endedAt (what the egress_ended webhook carries)
    const deadline = Date.now() + (ENDED_WITHIN_S + 60) * 1000;
    for (const t of tracks) {
      let e;
      while (Date.now() < deadline) {
        [e] = await eg.listEgress({ egressId: t.egressId });
        if (e && e.status >= 3) break;
        await sleep(2000);
      }
      const f = e?.file ?? e?.fileResults?.[0];
      t.egressStatus = STATUS[e?.status] ?? `unknown(${e?.status})`;
      t.error = e?.error || t.stopError || '';
      t.endedAtMs = e?.endedAt ? Number(e.endedAt / 1000000n) : 0;
      t.bytesEgress = Number(f?.size ?? 0);
      t.egressDurationSec = Number(f?.duration ?? 0) / 1e9;
    }
  } catch (err) {
    fatal = err.message;
  } finally {
    for (const s of pubs) {
      s.stop = true;
      await s.loop?.catch(() => {});
      await s.r.disconnect().catch(() => {});
    }
    await lk.dispose?.().catch?.(() => {});
  }
  if (fatal && tracks.length < PUBLISHERS.length)
    return couldNotRun(room, `setup failed: ${fatal}`);

  // 4) signed download, ffprobe, checksum
  const checks = [];
  if (fatal) checks.push({ name: 'run completed', pass: false, detail: fatal });
  for (const t of tracks) {
    Object.assign(t, await inspect(t.key).catch((err) => ({ inspectError: err.message })));
    checks.push(...trackChecks(t.publisher, t));
  }
  const v = verdict(checks);
  const prior = await priorPasses(room, STREAK_TARGET);
  const result = {
    card: 'WC-CV-5',
    cc: 'CC-68',
    room,
    startedAt,
    finishedAt: new Date().toISOString(),
    holdSeconds: HOLD,
    tracks: tracks.map(
      ({
        publisher,
        egressId,
        key,
        trackSid,
        egressStatus,
        error,
        stoppedAtMs,
        endedAtMs,
        bytesEgress,
        egressDurationSec,
        bytesR2,
        signedStatus,
        bytesDownloaded,
        sha256,
        durationSec,
        audioStreams,
        codec,
        sampleRate,
        meanVolumeDb,
      }) => ({
        publisher,
        egressId,
        key,
        trackSid,
        egressStatus,
        error,
        endedLagSec: endedAtMs && stoppedAtMs ? (endedAtMs - stoppedAtMs) / 1000 : null,
        bytesEgress,
        egressDurationSec,
        bytesR2,
        signedStatus,
        bytesDownloaded,
        sha256,
        durationSec,
        audioStreams,
        codec,
        sampleRate,
        meanVolumeDb,
      }),
    ),
    verdict: v,
    streak: streak(v.pass, prior),
  };
  report(checks);

  // 5) store the result next to the recordings (checksums live here)
  const body = JSON.stringify(result, null, 2);
  const put = signPut(cfg(), keys.result, body, 'application/json');
  const pr = await fetch(put.url, {
    method: 'PUT',
    headers: put.headers,
    body,
    signal: AbortSignal.timeout(30000),
  }).catch((err) => ({ ok: false, status: err.message }));
  console.log(
    `${pr.ok ? 'PASS' : 'FAIL'} result stored — s3://${E.RECORDING_S3_BUCKET}/${keys.result} (${pr.status})`,
  );
  if (!pr.ok) {
    v.pass = false;
    v.failures++;
    v.failed.push('result stored');
  }

  console.log(
    'CC68_RESULT ' +
      JSON.stringify({
        room,
        pass: v.pass,
        checks: v.checks,
        failures: v.failures,
        streak: result.streak,
        egressIds: tracks.map((t) => t.egressId),
        sha256: tracks.map((t) => t.sha256),
      }),
  );
  console.log('LEDGER ' + ledgerRow(result));
  if (!v.pass) {
    await page(
      `CC-68 nightly recording FAILED (${room})`,
      `${v.failures}/${v.checks} checks failed: ${v.failed.join('; ')}. Egress ${tracks.map((t) => t.egressId).join(', ')}. Re-check: node packages/conformance/cc68-nightly-recording.mjs verify ${room}`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// ------------------------------------------------------------------ verify (read-only)
async function verifyNight(room) {
  if (!/^syn-\d{8}$/.test(room || '') && !E.CC68_ROOM) {
    console.log('COULD NOT RUN — usage: verify syn-YYYYMMDD');
    process.exit(2);
  }
  const missing = REQ.filter((k) => !E[k]);
  if (missing.length) {
    console.log(`COULD NOT RUN — missing env ${missing.join(', ')}`);
    process.exit(2);
  }
  const keys = keysForRoom(
    room,
    PUBLISHERS.map((p) => p.id),
  );
  const stored = await getJson(keys.result);
  if (!stored) {
    console.log(`FAIL no result.json for ${room}`);
    process.exit(1);
  }
  console.log(
    `CC-68 verify (read-only) · ${room} · stored verdict ${stored.verdict.pass ? 'pass' : 'FAIL'} · ${stored.startedAt}`,
  );
  const { EgressClient } = await import('livekit-server-sdk');
  const eg = new EgressClient(httpsLk(), E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET);
  const checks = [];
  for (const t of stored.tracks) {
    let e = null;
    try {
      [e] = await eg.listEgress({ egressId: t.egressId });
    } catch {
      e = null;
    }
    if (e)
      checks.push({
        name: `${t.publisher}: LiveKit egress record`,
        pass: e.status === 3 && e.roomName === room,
        detail: `${STATUS[e.status]} room ${e.roomName}`,
      });
    else
      console.log(
        `INFO ${t.publisher}: ${t.egressId} no longer in LiveKit (egress records are short-lived); relying on R2`,
      );
    const now = await inspect(t.key);
    checks.push({
      name: `${t.publisher}: object checksum unchanged`,
      pass: now.sha256 === t.sha256,
      detail: `${(now.sha256 || 'none').slice(0, 16)} vs ${(t.sha256 || '').slice(0, 16)}`,
    });
    checks.push(
      ...trackChecks(t.publisher, {
        ...t,
        ...now,
        egressStatus: t.egressStatus,
        error: t.error,
        stoppedAtMs: 0,
        endedAtMs: 0,
      }).filter((c) => !c.name.includes('egress_ended')),
    );
    checks.push({
      name: `${t.publisher}: stored egress_ended lag ≤ ${ENDED_WITHIN_S} s`,
      pass: t.endedLagSec !== null && t.endedLagSec <= ENDED_WITHIN_S,
      detail: `${t.endedLagSec} s`,
    });
  }
  report(checks);
  const v = verdict(checks);
  console.log(
    `CC68_VERIFY ${JSON.stringify({ room, pass: v.pass, checks: v.checks, failures: v.failures })}`,
  );
  process.exit(v.pass ? 0 : 1);
}

// ------------------------------------------------------------------ ledger (read-only)
async function ledger(n) {
  const missing = REQ.filter((k) => k.startsWith('RECORDING') && !E[k]);
  if (missing.length) {
    console.log(`COULD NOT RUN — missing env ${missing.join(', ')}`);
    process.exit(2);
  }
  let room = roomForDate(new Date());
  for (let i = 0; i < n; i++, room = previousRoom(room)) {
    const j = await getJson(keysForRoom(room, []).result).catch(() => null);
    console.log(j ? ledgerRow(j) : `| CC-68 | ${room} | — | no run | — | — | — |`);
  }
}

if (MODE === 'run') {
  try {
    await run();
  } catch (err) {
    await couldNotRun(E.CC68_ROOM || roomForDate(new Date()), `uncaught: ${err.message}`);
  }
} else if (MODE === 'verify') await verifyNight(process.argv[3] || E.CC68_ROOM);
else if (MODE === 'ledger') await ledger(Number(process.argv[3] || 7));
else {
  console.log('usage: cc68-nightly-recording.mjs run | verify <syn-YYYYMMDD> | ledger [n]');
  process.exit(2);
}
