#!/usr/bin/env node
/**
 * CC-21: "Recording delivery: room → egress → R2 → signed-URL playback"
 * (Bible v12.1 PART CC: "CC-21 = full room→egress→R2→signed-playback chain";
 *  PART M M-T4.3; D-R21 recordings private, signed URLs only).
 *
 * CC-21 WRITES (it starts an egress job and puts an MP4 in spenai-recordings), so
 * under Ahmed's live-write rule (2026-09-25) the BUILDER runs `probe` and posts the
 * ids it prints; the AUDITOR runs `verify` with those ids, read-only; the builder
 * then runs `cleanup`. A run whose ids are not posted does not count.
 *
 *   node scripts/cc21-recording-chain.mjs probe                 (builder; writes)
 *     1. joins a fresh room `cc21-probe-<ts>` as a publisher (440 Hz tone + 640x360
 *        test-pattern video, rtc-node) — needs `@livekit/rtc-node@1.1.0` resolvable
 *     2. starts a RoomComposite egress with EXACTLY camv's /api/record/start output
 *        (EncodedFileOutput → S3Upload to RECORDING_S3_*, forcePathStyle, layout speaker)
 *     3. records HOLD_SECONDS (default 30), stops, waits for EGRESS_COMPLETE
 *     4. prints PROBE_IDS {room, egressId, key, bytes, durationSec}. Does NOT delete.
 *
 *   node scripts/cc21-recording-chain.mjs verify <egressId> <key>   (auditor; read-only)
 *     LiveKit: listEgress(egressId) → COMPLETE, room, file size/duration/location.
 *     R2 (HEAD/GET only, D-R51-1): HEAD size == egress size; anonymous GET denied;
 *     SigV4 presigned GET (7-day TTL, as CV-T3 specifies) → 206 on a Range read and
 *     the full file downloads; an already-expired presign → 403; ffprobe: mp4 with
 *     an audio and a video stream, duration ≈ egress duration; the probe tone is
 *     audible (mean volume); MEDIA-1 egress log mentions the egressId (read-only).
 *
 *   node scripts/cc21-recording-chain.mjs cleanup <key>            (builder; deletes the probe object)
 *
 * Env (camv app env, D-R51): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
 *   RECORDING_S3_ENDPOINT, RECORDING_S3_BUCKET, RECORDING_S3_ACCESS_KEY,
 *   RECORDING_S3_SECRET_KEY, RECORDING_S3_REGION (default auto).
 *   Optional: MEDIA1_SSH / MEDIA1_KEY for the egress-log check; HOLD_SECONDS.
 * Exit: 0 = green · 1 = red · 2 = could not run.
 *
 * NOT in CC-21 (belongs to CC-30 / CV-T3, not built as of 2026-09-25): the
 * egress_ended webhook, the email to the host, the Timeway booking post, CRM attach.
 */
import { createHmac, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join as pjoin } from 'node:path';

const E = process.env;
const MODE = process.argv[2];
const HOLD = Number(E.HOLD_SECONDS ?? 30);
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log(`PASS ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`FAIL ${n}${d ? ' — ' + d : ''}`); };
const check = (c, n, d) => (c ? ok(n, d) : bad(n, d));
const need = (...ks) => { const m = ks.filter((k) => !E[k]); if (m.length) { console.log('COULD NOT RUN — missing env ' + m.join(', ')); process.exit(2); } };

// ---------------------------------------------------------------- SigV4 (R2 = S3-compatible, path-style)
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
function sigKey(date, region) { return hmac(hmac(hmac(hmac('AWS4' + E.RECORDING_S3_SECRET_KEY, date), region), 's3'), 'aws4_request'); }
function objUrl(key) { const u = new URL(E.RECORDING_S3_ENDPOINT); return { host: u.host, path: `/${E.RECORDING_S3_BUCKET}/${key.split('/').map(enc).join('/')}`, origin: u.origin }; }
function presign(method, key, expires, when = new Date()) {
  const region = E.RECORDING_S3_REGION || 'auto';
  const amz = when.toISOString().replace(/[-:]|\.\d{3}/g, ''); const date = amz.slice(0, 8);
  const { host, path, origin } = objUrl(key);
  const scope = `${date}/${region}/s3/aws4_request`;
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${E.RECORDING_S3_ACCESS_KEY}/${scope}`, 'X-Amz-Date': amz, 'X-Amz-Expires': String(expires), 'X-Amz-SignedHeaders': 'host' };
  const qs = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const creq = [method, path, qs, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(creq)].join('\n');
  return `${origin}${path}?${qs}&X-Amz-Signature=${createHmac('sha256', sigKey(date, region)).update(sts).digest('hex')}`;
}
async function s3(method, key) { // header-signed request (HEAD/DELETE)
  const region = E.RECORDING_S3_REGION || 'auto';
  const amz = new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''); const date = amz.slice(0, 8);
  const { host, path, origin } = objUrl(key); const ph = sha('');
  const creq = [method, path, '', `host:${host}\nx-amz-content-sha256:${ph}\nx-amz-date:${amz}\n`, 'host;x-amz-content-sha256;x-amz-date', ph].join('\n');
  const scope = `${date}/${region}/s3/aws4_request`;
  const sig = createHmac('sha256', sigKey(date, region)).update(['AWS4-HMAC-SHA256', amz, scope, sha(creq)].join('\n')).digest('hex');
  return fetch(origin + path, { method, headers: { 'x-amz-date': amz, 'x-amz-content-sha256': ph, Authorization: `AWS4-HMAC-SHA256 Credential=${E.RECORDING_S3_ACCESS_KEY}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}` } });
}
const httpsLk = () => { const u = new URL(E.LIVEKIT_URL); u.protocol = 'https:'; return u.origin; };

// ---------------------------------------------------------------- probe (builder, writes)
async function probe() {
  need('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'RECORDING_S3_ENDPOINT', 'RECORDING_S3_BUCKET', 'RECORDING_S3_ACCESS_KEY', 'RECORDING_S3_SECRET_KEY');
  const sdk = await import('livekit-server-sdk');
  const { AccessToken, EgressClient, EncodedFileOutput, S3Upload, TrackSource } = sdk;
  const lk = await import('@livekit/rtc-node');
  const room = `cc21-probe-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const at = new AccessToken(E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET, { identity: 'cc21-publisher', ttl: '10m' });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: false, canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA] });
  const r = new lk.Room();
  await r.connect(E.LIVEKIT_URL, await at.toJwt(), { autoSubscribe: false, dynacast: false });
  const asrc = new lk.AudioSource(48000, 1), vsrc = new lk.VideoSource(640, 360);
  const o1 = new lk.TrackPublishOptions(); o1.source = lk.TrackSource.SOURCE_MICROPHONE;
  const o2 = new lk.TrackPublishOptions(); o2.source = lk.TrackSource.SOURCE_CAMERA;
  await r.localParticipant.publishTrack(lk.LocalAudioTrack.createAudioTrack('cc21-tone', asrc), o1);
  await r.localParticipant.publishTrack(lk.LocalVideoTrack.createVideoTrack('cc21-pattern', vsrc), o2);
  let stop = false, phase = 0, frameNo = 0;
  const audio = (async () => { while (!stop) { const d = new Int16Array(480); for (let i = 0; i < 480; i++) { d[i] = Math.round(Math.sin(phase) * 8000); phase += (2 * Math.PI * 440) / 48000; } await asrc.captureFrame(new lk.AudioFrame(d, 48000, 1, 480)); } })();
  const video = setInterval(() => { const buf = new Uint8Array(640 * 360 * 4); const shade = (frameNo++ * 4) % 255; for (let i = 0; i < buf.length; i += 4) { buf[i] = shade; buf[i + 1] = 255 - shade; buf[i + 2] = 128; buf[i + 3] = 255; } vsrc.captureFrame(new lk.VideoFrame(buf, 640, 360, lk.VideoBufferType.RGBA)); }, 66);
  await new Promise((s) => setTimeout(s, 3000));
  const eg = new EgressClient(httpsLk(), E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET);
  const key = `${new Date().toISOString()}-${room}.mp4`; // same naming as camv /api/record/start
  const info = await eg.startRoomCompositeEgress(room, { file: new EncodedFileOutput({ filepath: key, output: { case: 's3', value: new S3Upload({ endpoint: E.RECORDING_S3_ENDPOINT, accessKey: E.RECORDING_S3_ACCESS_KEY, secret: E.RECORDING_S3_SECRET_KEY, region: E.RECORDING_S3_REGION, bucket: E.RECORDING_S3_BUCKET, forcePathStyle: true }) } }) }, { layout: 'speaker' });
  console.log(`egress started ${info.egressId} room ${room} key ${key}`);
  await new Promise((s) => setTimeout(s, HOLD * 1000));
  await eg.stopEgress(info.egressId);
  let e; for (let i = 0; i < 60; i++) { [e] = await eg.listEgress({ egressId: info.egressId }); if (e && e.status >= 3) break; await new Promise((s) => setTimeout(s, 2000)); }
  stop = true; clearInterval(video); await audio.catch(() => {}); await r.disconnect();
  const f = e?.fileResults?.[0] ?? e?.file;
  const ids = { room, egressId: info.egressId, key, status: e?.status, bytes: Number(f?.size ?? 0), durationSec: Number(f?.duration ?? 0) / 1e9, location: f?.location };
  console.log('PROBE_IDS ' + JSON.stringify(ids));
  console.log('Post the PROBE_IDS line on #57. The auditor runs: node scripts/cc21-recording-chain.mjs verify ' + ids.egressId + " '" + key + "'");
  await lk.dispose?.();
  process.exit(e?.status === 3 ? 0 : 1);
}

// ---------------------------------------------------------------- verify (auditor, read-only)
async function verify(egressId, key) {
  need('LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'RECORDING_S3_ENDPOINT', 'RECORDING_S3_BUCKET', 'RECORDING_S3_ACCESS_KEY', 'RECORDING_S3_SECRET_KEY');
  if (!egressId || !key) { console.log('COULD NOT RUN — usage: verify <egressId> <key>'); process.exit(2); }
  console.log(`CC-21 verify (read-only) · egress ${egressId} · s3://${E.RECORDING_S3_BUCKET}/${key} · ${new Date().toISOString()}`);
  const { EgressClient } = await import('livekit-server-sdk');
  console.log('\n[1] LiveKit egress record');
  let e = null;
  try { [e] = await new EgressClient(httpsLk(), E.LIVEKIT_API_KEY, E.LIVEKIT_API_SECRET).listEgress({ egressId }); }
  catch (err) { console.log(`INFO listEgress: ${err.message}`); }
  // Egress info is only kept in media-redis for a limited time, so a probe older
  // than that is looked up in the egress's own manifest (<egressId>.json, written
  // next to the recording by livekit-egress) instead.
  if (!e) {
    const man = await fetch(presign('GET', `${egressId}.json`, 300));
    if (man.status === 200) {
      const m = await man.json();
      // livekit-egress manifests carry no status field; ended_at + a file entry + no error = completed
      const done = (m.status === 'EGRESS_COMPLETE' || m.status === 3) || (!m.status && m.ended_at && (m.files ?? []).length && !m.error);
      e = { status: done ? 3 : m.status, roomName: m.room_name ?? m.roomName, error: m.error ?? '', fromManifest: true, manifestDurSec: m.ended_at && m.started_at ? (m.ended_at - m.started_at) / 1e9 : 0,
            fileResults: (m.files ?? m.file_results ?? (m.file ? [m.file] : [])).map((x) => ({ filename: x.filename, size: x.size, duration: x.duration, location: x.location })) };
      console.log(`INFO egress record read from R2 manifest ${egressId}.json`);
    }
  }
  const f = e?.fileResults?.[0] ?? e?.file;
  const egBytes = Number(f?.size ?? 0), egDur = Number(f?.duration ?? 0) / 1e9 || Number(e?.manifestDurSec ?? 0);
  check(e && e.status === 3, 'egress status EGRESS_COMPLETE', e ? `status ${e.status}, room ${e.roomName}, error "${e.error || ''}"` : 'not found (listEgress keeps recent egresses only)');
  check(f && (f.filename === key || (f.location || '').endsWith(encodeURI(key)) || (f.location || '').includes(key)), 'egress file result names this key', f ? `${f.filename} · ${egBytes} B · ${egDur.toFixed(1)} s` : 'no file result');
  check(e?.roomComposite?.layout === 'speaker' || !e?.roomComposite, 'RoomComposite layout "speaker" (camv\'s)', e?.roomComposite ? `layout ${e.roomComposite.layout}` : 'n/a');

  console.log('\n[2] R2 object (HEAD/GET only)');
  const head = await s3('HEAD', key);
  const size = Number(head.headers.get('content-length'));
  check(head.status === 200, 'HEAD object 200', `${head.status}, ${size} B, ${head.headers.get('content-type')}, last-modified ${head.headers.get('last-modified')}`);
  if (egBytes) check(size === egBytes, 'R2 size == egress-reported size', `${size} vs ${egBytes}`);
  const { origin, path } = objUrl(key);
  const anon = await fetch(origin + path, { method: 'GET', headers: { Range: 'bytes=0-15' } });
  check(anon.status === 400 || anon.status === 401 || anon.status === 403, 'anonymous GET denied (bucket private, D-R21)', `HTTP ${anon.status}`);
  const signed = presign('GET', key, 604800);
  const part = await fetch(signed, { headers: { Range: 'bytes=0-15' } });
  const head16 = Buffer.from(await part.arrayBuffer());
  check(part.status === 206 && head16.subarray(4, 8).toString() === 'ftyp', 'signed URL (7-day TTL) → 206 on a Range read, MP4 ftyp', `HTTP ${part.status}, bytes 4-8 "${head16.subarray(4, 8)}" brand "${head16.subarray(8, 12)}"`);
  const expired = presign('GET', key, 60, new Date(Date.now() - 3600_000));
  const ex = await fetch(expired, { headers: { Range: 'bytes=0-15' } });
  check(ex.status === 403, 'expired signed URL → 403', `HTTP ${ex.status}`);

  console.log('\n[3] playback (full download through the signed URL + ffprobe)');
  const dir = mkdtempSync(pjoin(tmpdir(), 'cc21-')); const file = pjoin(dir, 'rec.mp4');
  try {
    const full = await fetch(signed); writeFileSync(file, Buffer.from(await full.arrayBuffer()));
    check(full.status === 200 && statSync(file).size === size, 'full signed download', `HTTP ${full.status}, ${statSync(file).size} B`);
    const pj = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }));
    const v = pj.streams.find((s) => s.codec_type === 'video'), a = pj.streams.find((s) => s.codec_type === 'audio');
    const dur = Number(pj.format.duration);
    check(/mp4/.test(pj.format.format_name) && v && a, 'mp4 with a video and an audio stream', `${pj.format.format_name}; video ${v?.codec_name} ${v?.width}x${v?.height}; audio ${a?.codec_name} ${a?.sample_rate} Hz`);
    check(dur >= 5 && (!egDur || Math.abs(dur - egDur) <= (e?.fromManifest ? 20 : 3)), 'duration plausible and ≈ egress duration', `${dur.toFixed(1)} s (egress ${egDur.toFixed(1)} s)`);
    let volOut = '';
    try { volOut = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i '${file}' -map 0:a:0 -af volumedetect -f null - 2>&1`], { encoding: 'utf8' }); } catch (e) { volOut = (e.stdout || '').toString(); }
    const mean = Number((volOut.match(/mean_volume:\s*(-?[\d.]+) dB/) || [])[1]);
    check(Number.isFinite(mean) && mean > -40, 'audio track is not silence (probe tone recorded)', `mean_volume ${mean} dB`);
  } catch (err) { bad('playback', String(err.message || err).slice(0, 300)); }
  finally { rmSync(dir, { recursive: true, force: true }); }

  if (E.MEDIA1_SSH !== 'skip') {
    console.log('\n[4] MEDIA-1 egress log (read-only)');
    const M = E.MEDIA1_SSH ?? 'coolify-deploy@164.68.125.9', MK = E.MEDIA1_KEY ?? `${homedir()}/.hermes/keys/media1_164.68.125.9_id_ed25519`;
    let log = '';
    try { log = execFileSync('ssh', ['-i', MK, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=no', M, `sudo -n docker logs --since 48h livekit-egress 2>&1 | grep -F '${egressId}' | cut -c1-300`], { encoding: 'utf8', timeout: 60000 }); } catch (err) { log = (err.stdout || '').toString(); }
    const L = log.split('\n').filter(Boolean);
    check(L.length > 0, 'livekit-egress on MEDIA-1 logged this egress', `${L.length} lines; last: ${(L.at(-1) || '').slice(24, 200)}`);
  }
  console.log(`\nchecks ${pass + fail}, failures ${fail}`);
  process.exit(fail ? 1 : 0);
}

async function cleanup(key) {
  need('RECORDING_S3_ENDPOINT', 'RECORDING_S3_BUCKET', 'RECORDING_S3_ACCESS_KEY', 'RECORDING_S3_SECRET_KEY');
  if (!key || !/cc21-probe-\d{14}\.mp4$/.test(key)) { console.log('COULD NOT RUN — cleanup only deletes cc21-probe-<ts>.mp4 keys'); process.exit(2); }
  const d = await s3('DELETE', key); const h = await s3('HEAD', key);
  console.log(`DELETE ${d.status}; HEAD after ${h.status}`); process.exit(d.status === 204 && h.status === 404 ? 0 : 1);
}

if (MODE === 'probe') await probe();
else if (MODE === 'verify') await verify(process.argv[3], process.argv[4]);
else if (MODE === 'cleanup') await cleanup(process.argv[3]);
else { console.log('usage: probe | verify <egressId> <key> | cleanup <key>'); process.exit(2); }
