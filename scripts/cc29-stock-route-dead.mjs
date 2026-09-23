#!/usr/bin/env node
/**
 * CC-29 — "Camv stock join route dead forever" (Bible v12 PART CC, D-R50-5).
 *
 * Conformance probe for RA-T1: the imported LiveKit-template route
 * `/api/connection-details` minted a LiveKit access token for ANY roomName with
 * no authentication whatsoever. It was deleted. This script asserts that it is
 * still dead, that nothing in the deployed client can call it again, and that
 * its authenticated replacement did not quietly re-open the same hole.
 *
 * Vocabulary (D-R50-3): this script is the only thing that may turn CC-29
 * `green`. A manual curl is `probed`, never green.
 *
 * Usage:   node scripts/cc29-stock-route-dead.mjs
 * Env:     BASE_URL   (default https://camv.co)   target origin
 *          PROBE_ROOM (default cc29-probe)        arbitrary room name to try
 *          ENDED_ROOM (optional)                  a known-ended booking room uid;
 *                                                 if unset, section 5's 410 check
 *                                                 is reported as SKIP, not PASS.
 * Exit:    0 = green (all checks passed) · 1 = red (>=1 failure) · 2 = could not run
 */

const BASE = (process.env.BASE_URL ?? 'https://camv.co').replace(/\/+$/, '');
const PROBE_ROOM = process.env.PROBE_ROOM ?? 'cc29-probe';
const ENDED_ROOM = process.env.ENDED_ROOM ?? '';
const STOCK = '/api/connection-details';

let pass = 0,
  fail = 0,
  skip = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function bad(name, detail) {
  fail++;
  failures.push(`${name} — ${detail}`);
  console.log(`  FAIL  ${name} — ${detail}`);
}
function skipped(name, detail) {
  skip++;
  console.log(`  SKIP  ${name} — ${detail}`);
}

/** A route is "dead" only if it 404s or 410s. 200/201/3xx-to-200/5xx are all failures. */
const DEAD = new Set([404, 410]);

async function probe(path, init = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...init });
  let body = '';
  try {
    body = (await res.text()).slice(0, 4096);
  } catch {
    /* HEAD etc. */
  }
  return { status: res.status, body, location: res.headers.get('location') };
}

/** Token-shaped response detector — the actual harm CC-29 exists to prevent. */
function looksLikeToken(body) {
  if (!body) return false;
  const hits = [];
  if (/participantToken/i.test(body)) hits.push('participantToken');
  if (/serverUrl/i.test(body)) hits.push('serverUrl');
  // a bare JWT (three base64url segments) is damning on its own
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(body)) hits.push('JWT');
  return hits.length ? hits.join(',') : false;
}

console.log(`CC-29 stock join route dead forever`);
console.log(`target: ${BASE}   probe room: ${PROBE_ROOM}`);
console.log('');

// ---------------------------------------------------------------- 1. verbs
console.log('1 · every HTTP verb on the stock route is dead');
for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
  const init = { method };
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify({ roomName: PROBE_ROOM, participantName: 'cc29' });
  }
  let r;
  try {
    r = await probe(`${STOCK}?roomName=${encodeURIComponent(PROBE_ROOM)}&participantName=cc29`, init);
  } catch (e) {
    bad(`${method} ${STOCK}`, `request threw: ${e.message}`);
    continue;
  }
  const tok = looksLikeToken(r.body);
  if (tok) bad(`${method} ${STOCK}`, `response carries credential material (${tok}) — route is ALIVE`);
  else if (DEAD.has(r.status)) ok(`${method} ${STOCK}`, `HTTP ${r.status}`);
  else bad(`${method} ${STOCK}`, `HTTP ${r.status} (expected 404 or 410)`);
}

// ------------------------------------------------- 2. path/casing variants
console.log('');
console.log('2 · path variants cannot resurrect it');
const variants = [
  `${STOCK}/`,
  '/API/connection-details',
  '/api/Connection-Details',
  '/api/connectionDetails',
  '/api/connection_details',
  `${STOCK}/index`,
  '/api/token',
  '/api/livekit/token',
];
for (const v of variants) {
  let r;
  try {
    r = await probe(`${v}?roomName=${encodeURIComponent(PROBE_ROOM)}&participantName=cc29`);
  } catch (e) {
    bad(`GET ${v}`, `request threw: ${e.message}`);
    continue;
  }
  // follow one redirect hop: a 308 to the canonical path must still end dead
  if (r.status >= 300 && r.status < 400 && r.location) {
    const next = r.location.startsWith('http') ? r.location.replace(BASE, '') : r.location;
    const r2 = await probe(next);
    const tok2 = looksLikeToken(r2.body);
    if (tok2) bad(`GET ${v}`, `redirects to ${next} which returns credential material (${tok2})`);
    else if (DEAD.has(r2.status)) ok(`GET ${v}`, `${r.status} -> ${next} -> ${r2.status}`);
    else bad(`GET ${v}`, `${r.status} -> ${next} -> HTTP ${r2.status} (expected 404/410)`);
    continue;
  }
  const tok = looksLikeToken(r.body);
  if (tok) bad(`GET ${v}`, `response carries credential material (${tok})`);
  else if (DEAD.has(r.status)) ok(`GET ${v}`, `HTTP ${r.status}`);
  else bad(`GET ${v}`, `HTTP ${r.status} (expected 404/410)`);
}

// ------------------------------------- 3. deployed client bundles are clean
console.log('');
console.log('3 · no deployed client bundle references the stock endpoint');
try {
  const roomRes = await fetch(`${BASE}/rooms/${encodeURIComponent(PROBE_ROOM)}`);
  const html = await roomRes.text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[A-Za-z0-9./_-]+\.js/g) ?? [])];
  if (chunks.length === 0) {
    bad('bundle scan', `no JS chunks found on /rooms/${PROBE_ROOM} (HTTP ${roomRes.status}) — scan is vacuous`);
  } else {
    let dirty = [];
    for (const c of chunks) {
      const js = await (await fetch(BASE + c)).text();
      if (js.includes('/api/connection-details')) dirty.push(c);
    }
    if (dirty.length) bad('bundle scan', `${dirty.length}/${chunks.length} chunks still reference the stock endpoint: ${dirty.join(', ')}`);
    else ok('bundle scan', `${chunks.length} chunks scanned, 0 reference ${STOCK}`);
  }
} catch (e) {
  bad('bundle scan', `could not scan: ${e.message}`);
}

// ---------------------------- 4. runtime env does not point at the dead route
console.log('');
console.log('4 · runtime endpoint config points at the authenticated route');
const configured = process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT;
if (configured === undefined) {
  skipped('NEXT_PUBLIC_CONN_DETAILS_ENDPOINT', 'not visible to this process (run inside the container to assert it)');
} else if (configured === STOCK || configured.endsWith(STOCK)) {
  bad('NEXT_PUBLIC_CONN_DETAILS_ENDPOINT', `set to the dead stock route (${configured}) — client default would 404 every join`);
} else if (configured.includes('booking-connection-details')) {
  ok('NEXT_PUBLIC_CONN_DETAILS_ENDPOINT', configured);
} else {
  bad('NEXT_PUBLIC_CONN_DETAILS_ENDPOINT', `unexpected value ${configured} — expected the booking-aware route`);
}

// ------------------- 5. the replacement route did not re-open the same hole
console.log('');
console.log('5 · the authenticated replacement still refuses unauthenticated rooms');
try {
  const r = await probe(`/api/booking-connection-details?roomName=${encodeURIComponent(PROBE_ROOM)}&participantName=cc29`);
  const tok = looksLikeToken(r.body);
  if (tok) bad('booking route / arbitrary room', `minted credential material (${tok}) for an unknown room — RA-T1 hole re-opened`);
  else if (r.status === 400 || r.status === 403 || r.status === 404 || r.status === 410)
    ok('booking route / arbitrary room', `HTTP ${r.status}, no token`);
  else bad('booking route / arbitrary room', `HTTP ${r.status} (expected 400/403/404/410), body: ${r.body.slice(0, 120)}`);
} catch (e) {
  bad('booking route / arbitrary room', `request threw: ${e.message}`);
}
try {
  const r = await probe('/api/booking-connection-details?roomName=tw-' + 'X'.repeat(22) + '&participantName=cc29');
  const tok = looksLikeToken(r.body);
  if (tok) bad('booking route / fabricated tw- uid', `minted credential material (${tok}) for a booking that does not exist`);
  else ok('booking route / fabricated tw- uid', `HTTP ${r.status}, no token`);
} catch (e) {
  bad('booking route / fabricated tw- uid', `request threw: ${e.message}`);
}
if (ENDED_ROOM) {
  try {
    const r = await probe(`/api/booking-connection-details?roomName=${encodeURIComponent(ENDED_ROOM)}&participantName=cc29`);
    const tok = looksLikeToken(r.body);
    if (tok) bad('booking route / ended meeting', `minted credential material (${tok}) after the join window closed (D-R25)`);
    else if (r.status === 410) ok('booking route / ended meeting', `HTTP 410, no token`);
    else bad('booking route / ended meeting', `HTTP ${r.status} (expected 410)`);
  } catch (e) {
    bad('booking route / ended meeting', `request threw: ${e.message}`);
  }
} else {
  skipped('booking route / ended meeting', 'ENDED_ROOM not supplied');
}

// ------------------------------------------------------------------ verdict
console.log('');
console.log('─'.repeat(64));
console.log(`CC-29: ${pass} passed, ${fail} failed, ${skip} skipped`);
if (fail) {
  console.log('');
  console.log('FAILURES:');
  for (const f of failures) console.log(`  · ${f}`);
  console.log('');
  console.log('CC-29 = RED');
  process.exit(1);
}
if (pass === 0) {
  console.log('CC-29 = COULD NOT RUN (no check actually executed)');
  process.exit(2);
}
console.log('CC-29 = GREEN');
process.exit(0);
