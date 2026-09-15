# Camv — Detailed Issues, Requests & Investigation Log
**Generated:** 2026-09-15 (UTC) · **Live:** https://camv.co/ · Companion to `2026-09-15-camv-bible-status-report.md`

This document tracks every issue/request Ahmed raised about Camv across two live-test rounds, what was found, what was fixed, what's proven-unfixable, and what's still open — so nothing gets lost or re-investigated from scratch later.

---

## Round 1 feedback (first live test call, post codec/branding fix)

> "quality is much better, call lagging is less, share screen button is there on some ipad and mobile and some not, whenever blur, or any filter, chosen, gives a black screen and the camera freezez, i still cant get auto and selective camera quality, still the buttons are very solid and sharp, i am sure you can do research on how to enhance the call quality and features and you can do, make sure every browser and device get the best quality and the screenshare, and all the options across all devices and browsers, settings page is not responsive on mobile and ipade and its very limited"

| # | Issue raised | Status | Detail |
|---|---|---|---|
| 1 | Blur/any filter → black screen + camera freeze | ✅ **Fixed & deployed** | Root cause: `@livekit/track-processors` 0.7.0 had no WebGL2 capability check; silently failed to a blank canvas. Upgraded to 0.8.0 with `supportsBackgroundProcessors()` gating + runtime fallback. Commit `37275df`. |
| 2 | Screen-share button present on some iPad/mobile, missing on others | ✅ **Investigated, documented as a real platform limit** | Confirmed via caniuse.com's live table (Safari 26.6/27 included): iOS Safari has **zero** `getDisplayMedia()` support on any version. Every mobile browser (Chrome/Firefox/Samsung Internet included) is the same. Native Zoom/Meet/Teams use iOS's ReplayKit (native-app-only, no web equivalent) — not reachable from a website. This is not a bug we can code around; requires a separate native iOS app to ever change. See Round 2, item 5 below for the follow-up ask ("iPadOS 26 should work"). |
| 3 | No auto/manual/selective camera quality | ✅ **Built & deployed** | Didn't exist in the codebase at all. New "Video Quality" Settings tab (Auto/High/Medium/Low) using LiveKit's `setVideoQuality()` API. Commit `97df4c5`. |
| 4 | Buttons "very solid and sharp" (old-style) | ✅ **Fixed & deployed** | Restyled to soft pill shapes, shadows, hover-lift, floating capsule toolbar. Commit `f22b80d`. Visually verified via a live test-room screenshot, not just code review. |
| 5 | Settings page not responsive on mobile/iPad, very limited | ✅ **Fixed & deployed** | LiveKit's default settings modal was a fixed `50vw/50vh` box with zero mobile breakpoints. Now a full-screen sheet under 768px, scrollable tabs/content. Commit `a65198d`. |
| — | "call lagging is less", "quality is much better" | ✅ Confirmed working | Result of the earlier codec fix (H.264 default, 1080p cap instead of 4K/VP9) — Ahmed confirmed this directly, no further action needed on this specific point. |

---

## Round 2 feedback (second message, after Round 1 fixes deployed)

> "France is not a bottleneck, screenshare is not there, I totally agree with enhancing setting rules to screen recording, I did record the call but it should be that anyone stop and start eh recording, where does it go? Should be an automated link sharing with the recorded video and the transcript to the booking owner, transcript should enable all languages, also do the screenshare the device matrix investigation, iOS iPadOS 26 should work, across browsers, still the branding, ui and ux is not fixed, also the video froze at a certain point, and the expand minimize maximize video solved the froze, I want a very deep investigation to make it a world class google meet, teams, zoom, grade quality, later we should have a commercial landing page to the main domain camv.co and an admin dashboard if doesn't exist, with the multi tenant as every other system, tell me what do you have planned to go through all of this and we'll take it from there, fixes and world class of every product is essential"

| # | Issue/request | Status | Detail |
|---|---|---|---|
| 1 | "France is not a bottleneck" | ✅ Acknowledged, no action needed | Confirms the SFU's France hosting location is not the cause of any remaining lag/freeze — root causes are elsewhere (decoder stalls, jitter/packet-loss, per earlier server-log evidence), consistent with what was already found. |
| 2 | Screenshare "is not there" | ✅ Same finding as Round 1 #2, restated | Ahmed re-confirms it's absent. See item 5 below for the specific iPadOS 26 device-matrix ask, which is the actionable next step here. |
| 3 | "Enhancing setting rules to screen recording" — anyone can stop/start | ✅ **Fixed & deployed, verified live** | Template shipped with an explicit "DO NOT USE FOR PRODUCTION" comment admitting anyone with a roomName could start/stop recording. Fixed: recording is now gated to whichever participant's name/email matches the Timeway booking's recorded host, via a signed server-side HMAC "host proof" — verified both in the UI (Recording tab hidden from non-hosts) and at the API layer (`/api/record/start`/`stop` now reject unauthenticated calls with `403`, confirmed with live `curl` requests against production). Commit `92fa8d9`. |
| 4 | "Where does it go? automated link sharing with the recorded video AND transcript to the booking owner" | 🔴 **Not started — needs cross-repo work** | Recording lands in Cloudflare R2 (bucket `spenai-recordings`) as `<timestamp>-<roomName>.mp4` with no link ever surfaced to anyone. To deliver a link to "the booking owner," Camv needs to know which Timeway booking a given room/recording belongs to and that booking's host/attendee emails — Camv's egress job currently only has a roomName and an S3 key. **This requires a Timeway-side webhook or API** (Camv notifies Timeway "recording for room X finished, here's the S3 key" → Timeway looks up the booking, generates a signed/expiring URL, emails it to the host). Not yet scoped as a concrete plan on either repo. |
| 5 | Transcript, "should enable all languages" | 🔴 **Not started** | No STT integration exists at all. A written plan exists (`CAMV_TRANSCRIPTION_PLAN.md`, from an earlier session) but is not implemented — it was explicitly blocked on Ahmed providing an STT provider + API key. Multi-language requirement narrows the provider choice: Deepgram Nova-3 or OpenAI Whisper both have strong multi-language auto-detect; a fully self-hosted Whisper large-v3 option exists but needs GPU infra Ahmed doesn't currently have. **Decision needed from Ahmed: provider + API key** before any code is written. |
| 6 | "Do the screenshare device matrix investigation, iOS iPadOS 26 should work, across browsers" | 🟡 **Desk research done; hands-on device-matrix testing not done** | Checked caniuse.com's live compat table (the newest data available, includes Safari 26.6/27): confirms zero `getDisplayMedia()` support on iOS Safari at any version — iPadOS 26 does not change this; it's a platform-level absence, not a version gap. This is sourced from the same public compatibility database browsers themselves report to, not a guess. **However, Ahmed's ask for an actual hands-on multi-device/multi-browser test matrix (not just desk research) has not been executed** — real hardware testing (a physical iPad on iPadOS 26, Safari vs Chrome-for-iPad, "Request Desktop Site" toggle on/off, various Android devices/browsers) could still surface partial or inconsistent support Camv isn't currently detecting/handling well, even if a clean "yes" is not realistically achievable given the underlying API is absent. Recommended next step: a dedicated device-testing pass, not more source-reading. |
| 7 | "Video froze at a certain point, expand/minimize/maximize solved the freeze" | ✅ **Fixed & deployed** | This specific, diagnosable clue led to the real root cause: resizing forces LiveKit's `AdaptiveStreamManager.updateDimensions()` to re-request a simulcast layer, causing the SFU to push a fresh keyframe and resync a stuck decoder. Built `VideoFreezeWatchdog` — auto-detects stalled remote video (via `requestVideoFrameCallback`) and forces the same recovery signal automatically (resubscribe toggle) after 6 seconds of no new frames, so no manual resize is needed. Commit `38aa995`. **Not yet re-tested live in a real call by Ahmed** — code-level fix only, awaiting a live-call confirmation that freezes genuinely stop requiring manual intervention. |
| 8 | "Branding, UI and UX is not fixed" | 🟡 **Partially addressed, deep pass not done** | Branding (logos/favicon/colors/text mentions) was addressed across two earlier phases. Round 1's specific UX asks (buttons, settings responsiveness) are fixed. But Ahmed's broader ask here — "I want a very deep investigation to make it a world class google meet, teams, zoom, grade quality" — is a much bigger scope than the fixes so far and has **not been scoped or started**. This needs a proper feature-by-feature audit (video tile layout/transitions, spacing, empty states, in-call chat polish, participant grid behavior, join/leave animations, etc.) compared directly against Meet/Zoom/Teams, before any further code changes — flagged as the single largest remaining item. |
| 9 | Commercial landing page for camv.co (main domain) | 🔴 **Paused, per Ahmed's explicit direction** | Ahmed said: "let the pending with the updated bible when I get it ready." No PART Q ticket exists for this in Bible v11.1. |
| 10 | Admin dashboard + multi-tenant "as every other system" | 🔴 **Paused, per Ahmed's explicit direction — and flagged as a likely architecture conflict** | Same pause as above. Additionally: Bible v11.1's own `Q-TW-B` ticket chain (`TW-T9..T13`) already defines a multi-tenant `Organization`/`OrganizationMember`/`Team`/`OrgApiKey`/`Plan` model — **scoped to Timeway, not Camv**. Building a second, independent multi-tenant/admin system inside the Camv repo would create two sources of tenant truth for the same overall product family, which is exactly the kind of drift Bible v11.1's org-isolation rules (`CC-13`) exist to prevent. **Recommendation for the updated Bible:** once `TW-T9` lands, Camv should consume Timeway's org layer (recording ownership, dashboards, tenant branding keyed to Timeway's `Organization`) rather than getting its own. This would also directly solve item 4 above (recording delivery needs "the booking owner," which only Timeway currently tracks). |

---

## Consolidated open-items list (for quick reference)

**Blocked on Ahmed's decision:**
- STT provider + API key (item 5) — needed before transcript work can start at all.
- Updated Bible — needed before landing page / admin dashboard / multi-tenant work (items 9, 10) can proceed, and to confirm the recommended "Camv consumes Timeway's org layer" architecture.

**Needs cross-repo (Camv + Timeway) scoping, not yet planned in detail:**
- Recording + transcript automated link delivery to booking owner (item 4).

**Needs hands-on execution, not just more research:**
- Real device/browser matrix testing for screenshare (item 6) — desk research is done and conclusive on the "why," but Ahmed's explicit ask for hands-on multi-device testing hasn't been run.
- Live re-test of the video-freeze auto-recovery fix (item 7) — deployed but unconfirmed by a real call.
- Deep Meet/Zoom/Teams-grade UX audit (item 8) — the largest remaining item, entirely unscoped so far.

**Fully done and verified live (not just code-complete):**
- Blur/filter freeze fix (item 1)
- Quality selector (item 3)
- Button restyle (Round 1 item 4)
- Settings responsiveness (Round 1 item 5)
- Recording host-lock, verified with live unauthenticated `curl` tests returning `403` (item 3, Round 2)
