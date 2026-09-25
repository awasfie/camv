#!/usr/bin/env node
/**
 * CC-19: "MEDIA-1 LiveKit deployment health per PART M"
 * (server + redis + egress + TURN + firewall). Bible v12.1 PART M (M-T1..M-T4), D-R27 pins.
 *
 * Read-only. Runs from the auditor's machine; everything on MEDIA-1 is a read
 * (docker inspect/logs, cat of config with secrets never printed, ufw status,
 * ss, iptables -S). External reachability is probed from a vantage host on a
 * different network, over IPv4 and IPv6, plus TURN/STUN over UDP and TLS from here.
 *
 * Usage:  node scripts/cc19-media1-health.mjs
 * Env:    MEDIA1_SSH  (default coolify-deploy@164.68.125.9)  MEDIA1_KEY (default ~/.hermes/keys/media1_164.68.125.9_id_ed25519)
 *         VANTAGE_SSH (default root@84.247.170.1)            VANTAGE_KEY (default ~/.hermes/keys/coolify_84.247.170.1_id_ed25519)
 *         APP_PLANE_IP (default 62.171.141.202: the only source allowed to scrape 9100/6789)
 *         COOLIFY_URL + COOLIFY_API_TOKEN (optional: MEDIA-1 reachable in Coolify)
 * Exit:   0 = green · 1 = red (>=1 failure) · 2 = could not run
 * Vocabulary (D-R50-3): only this script turns CC-19 green; a manual check is `probed`.
 */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import dgram from 'node:dgram';
import tls from 'node:tls';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { resolve4 } from 'node:dns/promises';

const H = homedir();
const M = process.env.MEDIA1_SSH ?? 'coolify-deploy@164.68.125.9';
const MK = process.env.MEDIA1_KEY ?? `${H}/.hermes/keys/media1_164.68.125.9_id_ed25519`;
const V = process.env.VANTAGE_SSH ?? 'root@84.247.170.1';
const VK = process.env.VANTAGE_KEY ?? `${H}/.hermes/keys/coolify_84.247.170.1_id_ed25519`;
const IP4 = '164.68.125.9';
const APP = process.env.APP_PLANE_IP ?? '62.171.141.202';

// D-R27 pins as recorded by RA-T6 (ops-log): exact tag + digest.
const PINS = {
  'livekit-server': ['livekit/livekit-server:v1.13.6', 'sha256:e37d68f172556d02aa77968b9fc55ef481468c0315fa38e4fa6c56ce72e3a815'],
  'livekit-egress': ['livekit/egress:v1.14.1', 'sha256:bf2b648b947349c3e9ff7aa8c718f00378d5c06af7624652a3653318e00333ce'],
  'media-redis': ['redis:7.4.11-alpine', 'sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf'],
};
// PART M M-T1.3 + M-T3.4 (+ scrape ports from the app plane only).
const UFW_EXPECTED = [
  '22/tcp ALLOW IN Anywhere', '80,443/tcp ALLOW IN Anywhere', '7881/tcp ALLOW IN Anywhere', '50000:60000/udp ALLOW IN Anywhere',
  '3478/udp ALLOW IN Anywhere', '5349/tcp ALLOW IN Anywhere', '7880/tcp ALLOW IN Anywhere',
  `9100/tcp ALLOW IN ${APP}`, `6789/tcp ALLOW IN ${APP}`,
];
const MUST_OPEN = [22, 80, 443, 7880, 7881, 5349];
const MUST_CLOSED = [6379, 6789, 7980, 8080, 9100]; // from anywhere except APP (9100/6789)

let pass = 0, fail = 0, warn = 0;
const ok = (n, d) => { pass++; console.log(`PASS ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d) => { fail++; console.log(`FAIL ${n}${d ? ' — ' + d : ''}`); };
const check = (c, n, d) => (c ? ok(n, d) : bad(n, d));
const note = (n, d) => { warn++; console.log(`WARN ${n}${d ? ' — ' + d : ''}`); };

function ssh(target, key, cmd, t = 120_000) {
  try {
    return execFileSync('ssh', ['-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10', target, cmd],
      { encoding: 'utf8', timeout: t, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
  } catch (e) { return (e.stdout || '').toString() + (e.stderr || '').toString(); }
}

function stun(host, port, timeoutMs = 4000) {
  // RFC 5389 Binding Request; success = Binding Success Response (0x0101) with our transaction id
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4');
    const tid = randomBytes(12);
    const msg = Buffer.concat([Buffer.from([0x00, 0x01, 0x00, 0x00, 0x21, 0x12, 0xa4, 0x42]), tid]);
    const done = (v) => { try { s.close(); } catch {} resolve(v); };
    const timer = setTimeout(() => done({ ok: false, why: 'timeout' }), timeoutMs);
    s.on('message', (b) => { clearTimeout(timer); done({ ok: b.readUInt16BE(0) === 0x0101 && b.subarray(8, 20).equals(tid), type: '0x' + b.readUInt16BE(0).toString(16) }); });
    s.send(msg, port, host, (e) => e && (clearTimeout(timer), done({ ok: false, why: e.message })));
  });
}

function peerCert(host, port, servername) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port, servername, rejectUnauthorized: true, timeout: 8000 }, () => {
      const c = sock.getPeerCertificate(true); sock.end();
      resolve({ ok: true, authorized: sock.authorized, cn: c.subject?.CN, validTo: c.valid_to, fp: c.fingerprint256 });
    });
    sock.on('error', (e) => resolve({ ok: false, why: e.message }));
    sock.on('timeout', () => { sock.destroy(); resolve({ ok: false, why: 'timeout' }); });
  });
}

const days = (d) => Math.floor((new Date(d) - Date.now()) / 86400000);

async function main() {
  console.log(`CC-19 MEDIA-1 health · ${M} · vantage ${V} · ${new Date().toISOString()}`);
  const who = ssh(M, MK, 'hostname; sudo -n true && echo SUDO_OK');
  if (!who.includes('SUDO_OK')) { console.log('COULD NOT RUN — MEDIA-1 ssh/sudo: ' + who.slice(0, 300)); process.exit(2); }

  // ---------------------------------------------------------------- 1 containers + pins
  console.log('\n[1] containers and D-R27 pins');
  const insp = ssh(M, MK, `sudo -n docker inspect -f '{{.Name}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}|{{.HostConfig.RestartPolicy.Name}}|{{.RestartCount}}|{{.HostConfig.NetworkMode}}|{{.State.StartedAt}}' $(sudo -n docker ps -aq)`);
  const cs = Object.fromEntries(insp.trim().split('\n').filter((l) => l.includes('|')).map((l) => { const [n, img, dig, st, rp, rc, net, sa] = l.split('|'); return [n.replace(/^\//, ''), { img, dig, st, rp, rc: +rc, net, sa }]; }));
  for (const [n, [img, dig]] of Object.entries(PINS)) {
    const c = cs[n];
    check(c && c.img === img && c.dig === dig, `${n} pinned`, c ? `${c.img} ${c.dig.slice(0, 19)}` : 'absent');
    check(c && c.st === 'running' && c.rp === 'unless-stopped', `${n} running, restart=unless-stopped`, c ? `${c.st}, ${c.rp}, restarts ${c.rc}, since ${c.sa.slice(0, 19)}Z, net ${c.net}` : 'absent');
  }
  const latest = Object.entries(cs).filter(([, c]) => /:latest$/.test(c.img) || !/:[^/]+$/.test(c.img));
  check(latest.length === 0, 'no :latest / untagged image on MEDIA-1', latest.map(([n, c]) => `${n}=${c.img}`).join(', ') || `${Object.keys(cs).length} containers, all tagged`);
  const notRunning = Object.entries(cs).filter(([, c]) => c.st !== 'running');
  check(notRunning.length === 0, 'every container running', notRunning.map(([n, c]) => `${n}=${c.st}`).join(', ') || Object.keys(cs).join(', '));

  // ---------------------------------------------------------------- 2 config essentials (secrets never printed)
  console.log('\n[2] livekit.yaml / egress.yaml essentials (PART M M-T3.2-3, M-T4.1)');
  const red = `sed -E 's/^([[:space:]]*(api_key|api_secret|access_key|secret|password|APIkey[A-Za-z0-9]*):[[:space:]]*).+/\\1***/'`;
  const lk = ssh(M, MK, `sudo -n cat /opt/livekit/livekit.yaml | ${red}`);
  const eg = ssh(M, MK, `sudo -n cat /opt/livekit/egress.yaml | ${red}`);
  const has = (txt, re) => re.test(txt);
  const lkWant = [[/^port: 7880$/m, 'port 7880'], [/tcp_port: 7881/, 'rtc.tcp_port 7881'], [/port_range_start: 50000/, 'range start 50000'], [/port_range_end: 60000/, 'range end 60000'],
    [/node_ip: 164\.68\.125\.9/, 'rtc.node_ip 164.68.125.9'], [/use_external_ip: true/, 'use_external_ip'], [/address: 127\.0\.0\.1:6379/, 'redis 127.0.0.1:6379 (media-redis, local)'],
    [/turn:\s*\n\s*enabled: true/, 'turn enabled'], [/domain: turn\.camv\.co/, 'turn domain'], [/tls_port: 5349/, 'turn tls 5349'], [/udp_port: 3478/, 'turn udp 3478']];
  const lkMiss = lkWant.filter(([re]) => !has(lk, re)).map(([, n]) => n);
  check(lkMiss.length === 0, 'livekit.yaml', lkMiss.length ? 'missing: ' + lkMiss.join(', ') : lkWant.map(([, n]) => n).join(' · '));
  const egWant = [[/ws_url: wss:\/\/lk\.camv\.co/, 'ws_url wss://lk.camv.co'], [/bucket: spenai-recordings/, 'bucket spenai-recordings'], [/r2\.cloudflarestorage\.com/, 'R2 endpoint'],
    [/force_path_style: true/, 'force_path_style'], [/region: auto/, 'region auto'], [/address: 127\.0\.0\.1:6379/, 'redis local'], [/insecure_skip_verify: false/, 'TLS verify on']];
  const egMiss = egWant.filter(([re]) => !has(eg, re)).map(([, n]) => n);
  check(egMiss.length === 0, 'egress.yaml', egMiss.length ? 'missing: ' + egMiss.join(', ') : egWant.map(([, n]) => n).join(' · '));

  // ---------------------------------------------------------------- 3 local services
  console.log('\n[3] redis + egress + livekit locally');
  const loc = ssh(M, MK, `echo PING $(sudo -n docker exec media-redis redis-cli ping); echo L $(sudo -n ss -Htln | awk '{print $4}' | sort -u | tr '\\n' ' '); echo EH $(curl -s -m 4 -o /dev/null -w '%{http_code}' http://127.0.0.1:7980/); echo LKOK $(curl -s -m 4 http://127.0.0.1:7880/); echo ERR_LK $(sudo -n docker logs --since 24h livekit-server 2>&1 | grep -cE '\\tERROR\\t|panic'); echo ERR_EG $(sudo -n docker logs --since 24h livekit-egress 2>&1 | grep -cE '\\tERROR\\t|panic')`);
  const kv = Object.fromEntries(loc.trim().split('\n').map((l) => [l.split(' ')[0], l.slice(l.indexOf(' ') + 1)]));
  const L = (kv.L || '').split(' ').filter(Boolean);
  check(kv.PING === 'PONG', 'media-redis answers PING', kv.PING);
  check(L.includes('127.0.0.1:6379') && !L.some((a) => /(^0\.0\.0\.0|^\*|^\[::\]):6379$/.test(a)), 'redis bound to 127.0.0.1 only', L.filter((a) => a.endsWith(':6379')).join(' '));
  check(kv.EH === '200' && L.includes('127.0.0.1:7980') && !L.some((a) => /(^0\.0\.0\.0|^\*|^\[::\]):7980$/.test(a)), 'egress health on 127.0.0.1:7980 only', `HTTP ${kv.EH}`);
  check(kv.LKOK === 'OK', 'livekit-server HTTP 7880 answers "OK"', kv.LKOK);
  check(kv.ERR_LK === '0' && kv.ERR_EG === '0', '0 ERROR/panic lines in 24h (livekit-server, egress)', `server ${kv.ERR_LK}, egress ${kv.ERR_EG}`);
  console.log(`INFO listeners: ${L.join(' ')}`);

  // ---------------------------------------------------------------- 4 firewall (host policy)
  console.log('\n[4] firewall policy on MEDIA-1');
  const uf = ssh(M, MK, 'sudo -n ufw status verbose');
  check(/Status: active/.test(uf) && /Default: deny \(incoming\)/.test(uf), 'ufw active, default deny incoming', (uf.match(/Default:.*$/m) || [''])[0]);
  const rules = uf.split('\n').filter((l) => /ALLOW|DENY|REJECT|LIMIT/.test(l) && !/\(v6\)/.test(l)).map((l) => l.replace(/\s+/g, ' ').trim());
  const miss = UFW_EXPECTED.filter((r) => !rules.includes(r));
  const extra = rules.filter((r) => !UFW_EXPECTED.includes(r));
  check(miss.length === 0 && extra.length === 0, 'ufw v4 rule set == PART M list', `missing: ${miss.join('; ') || 'none'} · extra: ${extra.join('; ') || 'none'}`);
  const v6 = uf.split('\n').filter((l) => /\(v6\)/.test(l)).length;
  check(v6 >= 7, 'ufw rules mirrored on v6', `${v6} v6 rules`);
  const pub = ssh(M, MK, `sudo -n docker ps --format '{{.Names}} {{.Ports}}' | grep -E '0\\.0\\.0\\.0:|\\[::\\]:' `);
  const du = ssh(M, MK, 'sudo -n iptables -S DOCKER-USER');
  const duRules = du.split('\n').filter((l) => l.startsWith('-A DOCKER-USER')).length;
  const publishedBeyond = pub.split('\n').filter(Boolean).flatMap((l) => [...l.matchAll(/0\.0\.0\.0:(\d+)->/g)].map((m) => +m[1])).filter((p) => ![80, 443].includes(p));
  console.log(`INFO docker-published v4 ports besides 80/443: ${[...new Set(publishedBeyond)].join(', ') || 'none'}; DOCKER-USER rules: ${duRules} (ufw INPUT does not filter Docker-published ports; D-R62)`);

  // ---------------------------------------------------------------- 5 external reachability (the test that matters)
  console.log(`\n[5] external reachability from ${V} (different network), v4 + v6`);
  const v6addr = (ssh(M, MK, "ip -6 addr show scope global | awk '/inet6/{print $2}' | head -1").trim().split('/')[0]) || '';
  const ports = [...MUST_OPEN, ...MUST_CLOSED].join(' ');
  const ext = ssh(V, VK, `for p in ${ports}; do timeout 5 bash -c "</dev/tcp/${IP4}/$p" 2>/dev/null && echo v4 $p 1 || echo v4 $p 0; done; ` +
    (v6addr ? `ping6 -c2 -W2 ${v6addr} >/dev/null; for p in ${ports}; do r=0; for i in 1 2 3; do timeout 6 bash -c "</dev/tcp/${v6addr}/$p" 2>/dev/null && { r=1; break; }; done; echo v6 $p $r; done` : ''), 240_000);
  const res = {}; for (const l of ext.split('\n')) { const m = l.match(/^(v4|v6) (\d+) ([01])$/); if (m) res[`${m[1]}:${m[2]}`] = m[3] === '1'; }
  for (const fam of ['v4', ...(v6addr ? ['v6'] : [])]) {
    const openBad = MUST_OPEN.filter((p) => !res[`${fam}:${p}`]);
    const closedBad = MUST_CLOSED.filter((p) => res[`${fam}:${p}`]);
    check(openBad.length === 0, `${fam} required ports reachable (${MUST_OPEN.join('/')})`, openBad.length ? 'NOT reachable: ' + openBad.join(', ') : 'all reachable');
    check(closedBad.length === 0, `${fam} internal ports NOT reachable from outside (${MUST_CLOSED.join('/')})`, closedBad.length ? 'REACHABLE: ' + closedBad.join(', ') : 'all filtered/closed');
  }
  if (res['v4:9100']) {
    const n = ssh(V, VK, `curl -s -m 5 http://${IP4}:9100/metrics | grep -c '^node_'`).trim();
    console.log(`INFO 9100 from ${V}: node-exporter served ${n} node_* metric lines (ufw allows only ${APP}; Docker's DNAT bypasses ufw INPUT)`);
  }

  // ---------------------------------------------------------------- 6 TURN / TLS / DNS (from here)
  console.log('\n[6] TURN, TLS, DNS');
  const st = await stun(IP4, 3478);
  check(st.ok, 'TURN/STUN UDP 3478 answers a Binding Request', JSON.stringify(st));
  for (const [h, p] of [['lk.camv.co', 443], ['turn.camv.co', 5349]]) {
    const c = await peerCert(h, p, h);
    check(c.ok && c.authorized && c.cn === h && days(c.validTo) >= 14, `TLS ${h}:${p} valid, CN matches, >= 14 days left`, c.ok ? `CN ${c.cn}, until ${c.validTo} (${days(c.validTo)} d)` : c.why);
    if (h === 'turn.camv.co' && c.ok) {
      const disk = ssh(M, MK, 'sudo -n openssl x509 -in /etc/letsencrypt/live/turn.camv.co/fullchain.pem -noout -fingerprint -sha256').trim().split('=').pop();
      check(disk && disk.toUpperCase() === c.fp.toUpperCase(), 'TURN cert served == cert on disk (livekit loaded the current renewal)', `served ${c.fp.slice(0, 23)}… disk ${disk.slice(0, 23)}…`);
      const hooks = ssh(M, MK, 'sudo -n ls /etc/letsencrypt/renewal-hooks/deploy/ 2>/dev/null; systemctl is-active certbot.timer').trim().split('\n');
      const timer = hooks.pop();
      check(timer === 'active', 'certbot.timer active (turn.camv.co renews via dns-cloudflare)', timer);
      if (!hooks.filter(Boolean).length) note('no certbot deploy hook restarts livekit-server', 'livekit reads the TURN cert only at start; after the ~30-days-before-expiry renewal it keeps serving the old cert until restarted. The served==disk check above catches the drift.');
    }
  }
  for (const h of ['lk.camv.co', 'turn.camv.co']) {
    const a = await resolve4(h).catch(() => []);
    check(a.length === 1 && a[0] === IP4, `DNS ${h} → ${IP4} (DNS-only, not proxied)`, a.join(', ') || 'no A record');
  }

  // ---------------------------------------------------------------- 7 Coolify (optional)
  if (process.env.COOLIFY_URL && process.env.COOLIFY_API_TOKEN) {
    console.log('\n[7] Coolify');
    try {
      const r = await fetch(`${process.env.COOLIFY_URL.replace(/\/$/, '')}/api/v1/servers`, { headers: { Authorization: `Bearer ${process.env.COOLIFY_API_TOKEN}` } });
      const s = (await r.json()).find((x) => x.ip === IP4);
      check(s && s.settings?.is_reachable && s.settings?.is_usable, 'MEDIA-1 reachable + usable in Coolify', s ? `${s.name} user=${s.user} reachable=${s.settings?.is_reachable} usable=${s.settings?.is_usable}` : 'not found');
    } catch (e) { bad('Coolify servers API', e.message); }
  }

  console.log(`\nchecks ${pass + fail}, failures ${fail}, warnings ${warn}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log('COULD NOT RUN — ' + (e?.stack || e)); process.exit(2); });
