#!/usr/bin/env node
/**
 * CC-34 — "Join-window 410 after end + 24h" (Bible v12 PART CC, D-R50-5).
 *
 * D-R25 (Bible v11.5) says a Camv room stays joinable from booking creation
 * until scheduled_end + 24h, and dies after that, so a stale or leaked join
 * link eventually stops working on its own. This script proves that boundary
 * against the LIVE endpoint, and proves the two ways it could be vacuously
 * "passing": the window being too tight (everything 410s) or too loose
 * (nothing ever 410s).
 *
 * DESIGN NOTE — expectations are DERIVED, never hard-coded.
 * A script that hard-codes "uid X must 410" rots the moment the clock moves:
 * today's in-window booking is tomorrow's expired one. So for every booking
 * uid this script reads the booking's real `endTime` from Timeway's internal
 * booking-window API (the same source the endpoint under test consults),
 * computes `endTime + 24h` itself, and only then asserts 410-vs-joinable.
 * That requires CAMV_INTERNAL_SECRET, i.e. it must run INSIDE the deployed
 * Camv container — which is also where D-R50-5 wants conformance scripts run.
 *
 * Usage:   node scripts/cc34-join-window.mjs
 * Env:     BASE_URL              (default https://camv.co)
 *          TIMEWAY_BASE_URL      (default https://timeway.co)
 *          CAMV_INTERNAL_SECRET  (required — container env)
 *          BOOKING_UIDS          (optional, comma-separated; default: the 8
 *                                 uids in the live Timeway Booking table as of
 *                                 2026-09-23. Unknown uids are skipped, so an
 *                                 out-of-date default degrades to SKIP, never
 *                                 to a false PASS.)
 * Exit:    0 = green · 1 = red (>=1 failure) · 2 = could not run
 */

const BASE = (process.env.BASE_URL ?? 'https://camv.co').replace(/\/+$/, '');
const TW = (process.env.TIMEWAY_BASE_URL ?? 'https://timeway.co').replace(/\/+$/, '');
const SECRET = process.env.CAMV_INTERNAL_SECRET ?? '';
const WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_UIDS = [
  'ww69ivkWkfoYgznpznXMon',
  'shza54q4PLqGWVRjrCzMgH',
  'qMqpSbCySZsVnpDCCuGMCa',
  '8Ehk2cgD2VBLmeGL77yWY1',
  'ksVcqQCd74RApRLgNzxTUH',
  '9Uob9EfZDj183JdPY5Sr5q',
  'hpm1yxrDrt8qnzKxG6dCJ1',
  '8V9Rjam1bCC7DiJPzhuwCY',
];

const uids = (process.env.BOOKING_UIDS ?? DEFAULT_UIDS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let pass = 0,
  fail = 0,
  skip = 0;
const failures = [];
const ok = (n, d) => {
  pass++;
  console.log(`  PASS  ${n}${d ? ` — ${d}` : ''}`);
};
const bad = (n, d) => {
  fail++;
  failures.push(`${n} — ${d}`);
  console.log(`  FAIL  ${n} — ${d}`);
};
const skipped = (n, d) => {
  skip++;
  console.log(`  SKIP  ${n} — ${d}`);
};

/**
 * The pass condition for a rejected join is "no credential material", not a
 * status code. A 410 that still hands back a LiveKit token is a breach.
 */
function carriesToken(body) {
  if (!body) return false;
  if (/participantToken|serverUrl|"?accessToken"?\s*:/.test(body)) return true;
  return /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(body);
}

async function join(roomName, participantName = 'cc34-probe') {
  const url = `${BASE}/api/booking-connection-details?roomName=${encodeURIComponent(
    roomName,
  )}&participantName=${encodeURIComponent(participantName)}`;
  const res = await fetch(url, { redirect: 'manual' });
  let body = '';
  try {
    body = (await res.text()).slice(0, 4096);
  } catch {
    /* ignore */
  }
  return { status: res.status, body };
}

async function bookingWindow(uid) {
  const res = await fetch(`${TW}/api/camv/booking-window/${encodeURIComponent(uid)}`, {
    headers: { 'x-camv-internal-secret': SECRET },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`booking-window ${uid}: HTTP ${res.status}`);
  return res.json();
}

function iso(ms) {
  return new Date(ms).toISOString().replace('.000', '');
}

async function main() {
  console.log('CC-34 join-window (end + 24h) — READ-ONLY');
  console.log(`  ran at            ${new Date().toISOString()}`);
  console.log(`  camv              ${BASE}`);
  console.log(`  timeway           ${TW}`);
  console.log(`  candidate uids    ${uids.length}`);

  if (!SECRET) {
    console.error(
      '\nCC-34 CANNOT RUN: CAMV_INTERNAL_SECRET is unset. Expectations must be derived from\n' +
        "live booking endTimes, not guessed. Run this inside the deployed Camv container.\n",
    );
    process.exit(2);
  }

  const expired = [];
  const live = [];

  for (const uid of uids) {
    let b;
    try {
      b = await bookingWindow(uid);
    } catch (e) {
      bad(`booking-window lookup ${uid}`, e.message);
      continue;
    }
    if (!b) {
      skipped(`booking ${uid}`, 'no longer present in Timeway — cannot derive an expectation');
      continue;
    }
    const endMs = Date.parse(b.endTime);
    if (Number.isNaN(endMs)) {
      bad(`booking ${uid}`, `unparseable endTime ${b.endTime}`);
      continue;
    }
    const closeMs = endMs + WINDOW_MS;
    (Date.now() > closeMs ? expired : live).push({ uid, b, endMs, closeMs });
  }

  // 1 · Past the window → 410, and no credential material in the body.
  console.log(`\n1. bookings past end+24h → 410 (${expired.length} found)`);
  for (const { uid, closeMs } of expired) {
    const r = await join(`tw-${uid}`);
    const age = Math.round((Date.now() - closeMs) / 3600000);
    if (r.status !== 410) bad(`tw-${uid} closed ${age}h ago`, `expected 410, got ${r.status}`);
    else if (carriesToken(r.body)) bad(`tw-${uid}`, '410 but response carries credential material');
    else ok(`tw-${uid}`, `410, window closed ${iso(closeMs)} (${age}h ago), no token`);
  }

  // 2 · Inside the window → joinable. This is the half that catches a window
  //     that is too TIGHT — e.g. a regression to "joinable only near the slot",
  //     which Ahmed explicitly ruled against (people join early / times move).
  console.log(`\n2. bookings inside the window → joinable (${live.length} found)`);
  for (const { uid, endMs, closeMs } of live) {
    const r = await join(`tw-${uid}`);
    const rel = endMs > Date.now() ? 'not yet ended' : `ended ${Math.round((Date.now() - endMs) / 3600000)}h ago`;
    if (r.status === 200 && carriesToken(r.body))
      ok(`tw-${uid}`, `200 + token, ${rel}, window closes ${iso(closeMs)}`);
    else if (r.status === 410)
      bad(`tw-${uid}`, `410 while still inside the window (closes ${iso(closeMs)}) — window too tight`);
    else if (r.status === 429) skipped(`tw-${uid}`, '429 rate-limited — inconclusive, re-run in 60s');
    else bad(`tw-${uid}`, `expected 200 with a token, got ${r.status}`);
  }

  // 3 · Vacuous-pass guards on the population itself.
  console.log('\n3. population guards');
  if (expired.length === 0)
    bad('expired-population', 'no booking is past end+24h — section 1 asserted nothing');
  else ok('expired-population', `${expired.length} booking(s) exercise the 410 path`);
  if (live.length === 0)
    skipped(
      'live-population',
      'no booking is currently inside its window — the "too tight" direction is untested this run',
    );
  else ok('live-population', `${live.length} booking(s) exercise the still-joinable path`);

  // 4 · Boundary is end+24h, not end. Only assertable when a booking has
  //     already ended but is still inside its 24h tail.
  console.log('\n4. boundary is end+24h, not end');
  const tail = live.filter((x) => x.endMs < Date.now());
  if (tail.length === 0)
    skipped('tail-booking', 'no booking is currently in the post-end 24h tail');
  else {
    for (const { uid, endMs } of tail) {
      const r = await join(`tw-${uid}`);
      const h = ((Date.now() - endMs) / 3600000).toFixed(1);
      if (r.status === 200) ok(`tw-${uid}`, `ended ${h}h ago and still joinable — tail honored`);
      else bad(`tw-${uid}`, `ended ${h}h ago (inside the 24h tail) but returned ${r.status}`);
    }
  }

  // 5 · Non-bookings must never reach the window logic at all.
  console.log('\n5. inputs that are not real bookings');
  const fabricated = `tw-cc34${Math.random().toString(36).slice(2, 12)}`;
  const f = await join(fabricated);
  if (f.status === 404 && !carriesToken(f.body)) ok(fabricated, '404, no token');
  else if (f.status === 429) skipped(fabricated, '429 rate-limited — inconclusive');
  else bad(fabricated, `expected 404 without a token, got ${f.status}`);

  const noPrefix = await join('cc34-not-a-timeway-room');
  if (noPrefix.status === 400 && !carriesToken(noPrefix.body)) ok('non tw- room name', '400, no token');
  else if (noPrefix.status === 429) skipped('non tw- room name', '429 rate-limited — inconclusive');
  else bad('non tw- room name', `expected 400 without a token, got ${noPrefix.status}`);

  const empty = await join('tw-');
  if ([400, 404].includes(empty.status) && !carriesToken(empty.body))
    ok('empty booking uid ("tw-")', `${empty.status}, no token`);
  else if (empty.status === 429) skipped('empty booking uid', '429 rate-limited — inconclusive');
  else bad('empty booking uid ("tw-")', `expected 400/404 without a token, got ${empty.status}`);

  // 6 · Cancelled bookings are a different rejection (403) — only assertable
  //     if one exists. Never a PASS by absence.
  console.log('\n6. cancelled/rejected bookings → 403');
  const cancelled = [...expired, ...live].filter((x) =>
    ['CANCELLED', 'REJECTED'].includes(String(x.b.status).toUpperCase()),
  );
  if (cancelled.length === 0) skipped('cancelled booking', 'none exist in the live Timeway data');
  else
    for (const { uid } of cancelled) {
      const r = await join(`tw-${uid}`);
      if ([403, 410].includes(r.status) && !carriesToken(r.body)) ok(`tw-${uid}`, `${r.status}, no token`);
      else bad(`tw-${uid}`, `cancelled booking returned ${r.status}`);
    }

  console.log(`\nCC-34: ${pass} passed, ${fail} failed, ${skip} skipped`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f2 of failures) console.log(`  - ${f2}`);
  }
  if (pass === 0) {
    console.log('CC-34 = INCONCLUSIVE (nothing asserted)');
    process.exit(2);
  }
  console.log(fail === 0 ? 'CC-34 = GREEN' : 'CC-34 = RED');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`CC-34 could not run: ${e?.stack || e}`);
  process.exit(2);
});
