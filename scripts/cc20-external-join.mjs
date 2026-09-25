#!/usr/bin/env node
/**
 * CC-20: "External LiveKit join reproduced by Gosi from a different network"
 * (Bible v12.1 PART CC; PART M M-T3.5; D-R51-2).
 *
 * What "green" means here: two real participants, joining from a network that
 * is NOT the one the builder used for M-T3 (Simon's M-T3 join ran from the Mac
 * mini, egress IP 94.204.179.132), connect to lk.camv.co, one publishes an
 * audio track, and the other RECEIVES decoded audio frames that are not
 * silence. The media server's own log must confirm the join (participant
 * active, remote address = the vantage IP, connection type).
 *
 * Three modes. Only `run` is invoked by hand; the other two are used by `run`.
 *
 *   node scripts/cc20-external-join.mjs run
 *     Two passes: `direct` (ICE all) and `turn-relay` (ICE forced to relay via the
 *     server's embedded TURN, turn.camv.co). Each pass orchestrates from the auditor's machine:
 *       1. mint two short-lived, room-scoped tokens locally (D-R51-2: local
 *          signing, not a server write); the API secret never leaves this box
 *       2. copy this file + the tokens to the vantage host; run `join` there in
 *          a throwaway node:22 container (the -slim image has no CA bundle, which rtc-node's Rust TLS needs) (nothing installed on the host)
 *       3. read MEDIA-1's livekit-server log for the probe room (read-only)
 *     Env: LIVEKIT_API_KEY, LIVEKIT_API_SECRET  (camv app env, D-R51-2)
 *          LIVEKIT_URL      (default wss://lk.camv.co)
 *          VANTAGE_SSH      (default "root@84.247.170.1"; key via VANTAGE_KEY)
 *          VANTAGE_KEY      (default ~/.hermes/keys/coolify_84.247.170.1_id_ed25519)
 *          MEDIA1_SSH       (default "coolify-deploy@164.68.125.9")
 *          MEDIA1_KEY       (default ~/.hermes/keys/media1_164.68.125.9_id_ed25519)
 *          BUILDER_IPS      (default "94.204.179.132"; the vantage must differ)
 *          HOLD_SECONDS     (default 15; how long audio is published)
 *
 *   node scripts/cc20-external-join.mjs join     (inside the container)
 *     Env: LIVEKIT_URL, TOKEN_PUB, TOKEN_SUB, HOLD_SECONDS. Prints one JSON line.
 *
 *   node scripts/cc20-external-join.mjs mint     (debug: prints tokens JSON)
 *
 * Exit: 0 = green (all checks passed) · 1 = red (>=1 failure) · 2 = could not run
 * Vocabulary (D-R50-3): only this script turns CC-20 green; a manual join is `probed`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join as pjoin, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE = process.argv[2] ?? 'run';
const URL_ = process.env.LIVEKIT_URL ?? 'wss://lk.camv.co';
const HOLD = Number(process.env.HOLD_SECONDS ?? 15);
const RTC_NODE = '@livekit/rtc-node@1.1.0';

let pass = 0, fail = 0;
const ok = (name, detail) => { pass++; console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`); };
const bad = (name, detail) => { fail++; console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

async function mint(room) {
  const { AccessToken, TrackSource } = await import('livekit-server-sdk');
  const { LIVEKIT_API_KEY: k, LIVEKIT_API_SECRET: s } = process.env;
  if (!k || !s) throw new Error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set');
  const tok = async (identity, grant) => {
    const at = new AccessToken(k, s, { identity, ttl: '10m', metadata: JSON.stringify({ cc: 'CC-20', probe: true }) });
    at.addGrant({ room, roomJoin: true, canPublishData: false, ...grant });
    return at.toJwt();
  };
  return {
    room,
    pub: await tok('cc20-publisher', { canPublish: true, canSubscribe: false, canPublishSources: [TrackSource.MICROPHONE] }),
    sub: await tok('cc20-subscriber', { canPublish: false, canSubscribe: true }),
  };
}

// ---------------------------------------------------------------- join (vantage)
async function joinMode() {
  const out = { ip: null, pubConnected: false, subConnected: false, subscribed: false, frames: 0, rms: 0, sampleRate: 0, errors: [] };
  try { out.ip = (await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) })).text()).trim(); } catch (e) { out.errors.push('ipify ' + e.message); }
  const lk = await import('@livekit/rtc-node');
  const { Room, RoomEvent, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, AudioFrame, AudioStream, TrackKind, IceTransportType, ContinualGatheringPolicy } = lk;
  // RELAY=1 forces every ICE candidate through TURN (the server's own turn.camv.co,
  // advertised in the join response), proving the NAT-traversal path M-T3.5 exists for.
  const rtcConfig = process.env.RELAY === '1'
    ? { iceTransportType: IceTransportType.TRANSPORT_RELAY, continualGatheringPolicy: ContinualGatheringPolicy.GATHER_CONTINUALLY, iceServers: [] }
    : undefined;
  out.relay = process.env.RELAY === '1';
  const sub = new Room();
  const pub = new Room();
  let sumSq = 0, n = 0;
  const gotTrack = new Promise((resolve) => {
    sub.on(RoomEvent.TrackSubscribed, async (track) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      out.subscribed = true; resolve();
      const stream = new AudioStream(track, 48000, 1);
      const it = stream[Symbol.asyncIterator] ? stream : stream.getReader?.() && { [Symbol.asyncIterator]: async function* () { const r = stream.getReader(); for (;;) { const { value, done } = await r.read(); if (done) return; yield value; } } };
      for await (const f of it) {
        out.frames++; out.sampleRate = f.sampleRate;
        for (const v of f.data) { sumSq += v * v; n++; }
      }
    });
  });
  try {
    await sub.connect(process.env.LIVEKIT_URL, process.env.TOKEN_SUB, { autoSubscribe: true, dynacast: false, rtcConfig });
    out.subConnected = true;
    await pub.connect(process.env.LIVEKIT_URL, process.env.TOKEN_PUB, { autoSubscribe: false, dynacast: false, rtcConfig });
    out.pubConnected = true;
    const src = new AudioSource(48000, 1);
    const track = LocalAudioTrack.createAudioTrack('cc20-tone-440hz', src);
    const opts = new TrackPublishOptions(); opts.source = TrackSource.SOURCE_MICROPHONE;
    await pub.localParticipant.publishTrack(track, opts);
    const spf = 480; let phase = 0; const end = Date.now() + HOLD * 1000;
    const timeout = setTimeout(() => {}, (HOLD + 20) * 1000);
    while (Date.now() < end) {
      const d = new Int16Array(spf);
      for (let i = 0; i < spf; i++) { d[i] = Math.round(Math.sin(phase) * 8000); phase += (2 * Math.PI * 440) / 48000; }
      await src.captureFrame(new AudioFrame(d, 48000, 1, spf));
    }
    clearTimeout(timeout);
    await Promise.race([gotTrack, new Promise((r) => setTimeout(r, 5000))]);
    await new Promise((r) => setTimeout(r, 1500));
  } catch (e) { out.errors.push(String(e?.message ?? e)); }
  out.rms = n ? Math.round(Math.sqrt(sumSq / n)) : 0;
  try { await pub.disconnect(); } catch {}
  try { await sub.disconnect(); } catch {}
  console.log('CC20_RESULT ' + JSON.stringify(out));
  try { await lk.dispose?.(); } catch {}
  process.exit(0);
}

// ---------------------------------------------------------------- run (auditor)
function ssh(target, key, cmd, input) {
  return execFileSync('ssh', ['-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', target, cmd],
    { encoding: 'utf8', input, timeout: 300_000, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
}

async function runMode() {
  const H = homedir();
  const V = process.env.VANTAGE_SSH ?? 'root@84.247.170.1';
  const VK = process.env.VANTAGE_KEY ?? `${H}/.hermes/keys/coolify_84.247.170.1_id_ed25519`;
  const M = process.env.MEDIA1_SSH ?? 'coolify-deploy@164.68.125.9';
  const MK = process.env.MEDIA1_KEY ?? `${H}/.hermes/keys/media1_164.68.125.9_id_ed25519`;
  const builder = (process.env.BUILDER_IPS ?? '94.204.179.132').split(',').map((s) => s.trim());
  const me = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  console.log(`CC-20 external join · ${URL_} · vantage ${V} · ${new Date().toISOString()}`);

  // one pass = mint room-scoped tokens here, join from the vantage, read MEDIA-1's log
  async function pass_(label, relay) {
    const room = `cc20-${relay ? 'relay' : 'direct'}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
    const started = new Date(Date.now() - 2000);
    let t;
    try { t = await mint(room); } catch (e) { console.log(`COULD NOT RUN — mint: ${e.message}`); process.exit(2); }
    const dir = `/tmp/cc20-${process.pid}-${relay ? 'r' : 'd'}`;
    const env = `LIVEKIT_URL=${URL_}\nTOKEN_PUB=${t.pub}\nTOKEN_SUB=${t.sub}\nHOLD_SECONDS=${HOLD}\nRELAY=${relay ? 1 : 0}\n`;
    let raw;
    try {
      ssh(V, VK, `umask 077; mkdir -p ${dir} && cat > ${dir}/cc20.mjs`, me);
      ssh(V, VK, `umask 077; cat > ${dir}/env`, env);
      raw = ssh(V, VK,
        `docker run --rm --env-file ${dir}/env -v ${dir}:/w -w /w node:22 sh -c ` +
        `'npm init -y >/dev/null 2>&1; npm i --silent --no-audit --no-fund ${RTC_NODE} >/dev/null 2>&1 && node cc20.mjs join' 2>&1; rm -rf ${dir}`);
    } catch (e) {
      try { ssh(V, VK, `rm -rf ${dir}`); } catch {}
      console.log(`COULD NOT RUN — vantage: ${(e.stderr || e.message || '').toString().slice(0, 400)}`); process.exit(2);
    }
    const line = raw.split('\n').find((l) => l.startsWith('CC20_RESULT '));
    if (!line) { console.log('COULD NOT RUN — no result line from vantage:\n' + raw.slice(-1500)); process.exit(2); }
    const r = JSON.parse(line.slice(12));
    let log = '';
    try { log = ssh(M, MK, `sudo -n docker logs --since ${started.toISOString()} livekit-server 2>&1 | grep -F '${room}' | cut -c1-1500`); }
    catch (e) { log = (e.stdout || '').toString(); }
    const lines = log.split('\n').filter(Boolean);
    const active = lines.filter((l) => /participant active/i.test(l));
    const types = [...new Set(active.map((l) => (l.match(/"connectionType":\s*"([a-z]+)"/) || [])[1]).filter(Boolean))];
    // Signalling arrives through Traefik (bridge -> host network), so addresses in
    // signalling lines are Docker bridge IPs. The MEDIA path is what matters: the
    // selected ICE pair ("ice reconnected or switched pair") logs remoteAddress,
    // masked by livekit-server after the third octet ("167.86.114....").
    const pairs = lines.filter((l) => /switched pair|selected pair|ice connected/i.test(l));
    const media = [...new Set(pairs.flatMap((l) => [...l.matchAll(/"remoteAddress":\s*"([^"]+)"/g)].map((m) => m[1])))];
    const cand = [...new Set(pairs.flatMap((l) => [...l.matchAll(/"remoteCandidateType":\s*"([a-z]+)"/g)].map((m) => m[1])))];
    const closed = lines.some((l) => /participant closing/i.test(l));

    console.log(`\n== pass: ${label} · room ${room}`);
    check(r.subConnected, `[${label}] subscriber connected to ${URL_}`);
    check(r.pubConnected, `[${label}] publisher connected and published a 440 Hz audio track`);
    check(r.subscribed, `[${label}] subscriber received the publisher's track (TrackSubscribed)`);
    check(r.frames >= HOLD * 50, `[${label}] decoded audio frames received`, `${r.frames} frames (>= ${HOLD * 50} for ${HOLD}s at 10 ms) @ ${r.sampleRate} Hz`);
    check(r.rms > 1000, `[${label}] received audio is the tone, not silence`, `RMS ${r.rms} (sent amplitude 8000 → RMS ≈ 5657)`);
    if (r.errors.length) bad(`[${label}] client errors`, r.errors.join(' | '));
    check(active.length >= 2, `[${label}] MEDIA-1 logged both participants active`, `${active.length} lines; connectionType ${types.join(',') || '?'}`);
    if (relay) {
      // The client ran with iceTransportType=RELAY, so it had NO candidate except
      // the TURN relay: received audio (checked above) is itself proof the TURN
      // path works. MEDIA-1's log must corroborate it by at least one of its two
      // signals, which vary run to run: "participant active" connectionType=turn
      // (logged at first connect, can read "udp" before ICE settles), or selected
      // ICE pairs whose remote end is MEDIA-1's own relay (masked "164.68.12...";
      // the pair line only appears when ICE switches). And no pair may point at
      // the vantage's own address.
      const relayHost = process.env.RELAY_HOST ?? '164.68.125.9';
      const vpref = (r.ip || '').split('.').slice(0, 3).join('.') + '.';
      const pairsViaRelay = media.length > 0 && media.every((a) => relayHost.startsWith(a.replace(/\.+$/, '')));
      const anyTurn = types.includes('turn');
      const leak = media.some((a) => a.startsWith(vpref));
      check((anyTurn || pairsViaRelay) && !leak, `[${label}] MEDIA-1 corroborates the TURN relay path`,
        `participant connectionType ${types.join(',') || '?'}; ICE pair remoteAddress ${media.join(', ') || '(no pair-switch line)'}; candidate types ${cand.join(',') || '?'}; direct pair to vantage: ${leak}`);
    } else {
      const prefix = (r.ip || '').split('.').slice(0, 3).join('.') + '.';
      check(media.length > 0 && media.every((a) => a.startsWith(prefix)), `[${label}] media (ICE selected pair) came from the vantage network`,
        `server-side remoteAddress ${media.join(', ') || 'none'} (masked by livekit) vs vantage ${r.ip}; candidate types ${cand.join(',') || '?'}`);
    }
    console.log(`INFO [${label}] room lines ${lines.length}; participant closing logged: ${closed}`);
    return r;
  }

  const d = await pass_('direct', false);
  console.log('\n== vantage network');
  check(d.ip && !builder.includes(d.ip), "vantage egress IP differs from the builder's M-T3 network", `vantage ${d.ip}; builder ${builder.join(',')}`);
  await pass_('turn-relay', true);

  console.log(`\nchecks ${pass + fail}, failures ${fail}`);
  process.exit(fail ? 1 : 0);
}

if (MODE === 'join') await joinMode();
else if (MODE === 'mint') console.log(JSON.stringify(await mint(process.env.ROOM ?? 'cc20-debug')));
else await runMode();
