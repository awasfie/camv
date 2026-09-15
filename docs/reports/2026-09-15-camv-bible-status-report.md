# Camv Status Report — Before & After Bible v11.1
**Generated:** 2026-09-15 (UTC)
**Repo:** `awasfie/camv` · **Live:** https://camv.co/ · **Deploy target:** Coolify app `cucdml7amfveflswxcjgzdmt` on 62.171.141.202
**Media backend:** LiveKit SFU on `lk.camv.co` (164.68.125.9, "MEDIA-1") · Egress → Cloudflare R2 bucket `spenai-recordings`

> Scope note per Bible v11.1 PART PF: Camv is PF.2, **vision-law, not a work order** — "nothing in PF is buildable without a PART Q ticket." Everything below (branding, bug fixes, UX) was executed as direct operational work at Ahmed's request, **outside** the Bible's PR/audit/Gosi loop — pushed straight to `main` and deployed by the agent, not routed through Q-tickets or CC gates. This report exists so that work has a paper trail even though it never passed through PART Q.

---

## 1. Timeline relative to Bible v11.1

Bible v11.1 is dated 2026-09-13 (file mtime; supersedes v9, dated 2026-09-08). Camv's git history:

| Date | Commit | What | Relative to v11.1 |
|---|---|---|---|
| 2026-09-13 | `8a69d8e` | Imported `livekit-examples/meet` (Apache-2.0) as Camv v0 base | **Before** v11.1 (same day, earlier) |
| 2026-09-13 | `4c657e4` | Dropped upstream CI workflows (Coolify-only deploy) | Before |
| 2026-09-14 | `e24dc3d` → `222bcc9` | TW-T7 phase 1: booking-aware token endpoint, Dockerfile/Coolify wiring, fixed broken git-lfs image pointers, surfaced booking errors, removed join time-window restriction | Before |
| 2026-09-14 | `0b2eaab`, `85ca530` | Branding pass 1: purged LiveKit Meet branding (favicon/logo/OG image), restyled call UI to Camv palette | Before |
| 2026-09-15 | `4665318` | Removed remaining "LiveKit" mentions from public home page | **After** — first work session post-v11.1 |
| 2026-09-15 | `6a6ef96`, `512817a`, `f85cf62` | Recording S3 env vars + status endpoint + transcription plan doc; codec fix (h264 default, cap 1080p not 4K); merged screenshare-notice + recording branches | After |
| 2026-09-15 | `37275df` → `92fa8d9` (7 commits) | **This session's work** — see §3 below | After |

**TW-T7 (Timeway integration work)** is referenced directly inside Camv commits (`e24dc3d`, `bb9a354`, `b38dcf0`, `222bcc9`) — this is the only piece of Camv work that maps to an actual Bible ticket ID; everything else (branding, UX, bug fixes) has no PART Q ticket number because none was ever cut for it.

---

## 2. What Bible v11.1 actually says about Camv (verified by reading the file directly, not from memory)

- **PART PF.2** — Camv exists as a named product-family vision item, but PF is explicitly "vision-law, not a work order."
- **PART Q, `Q-TW-B`** — the only concrete queued ticket chain touching this product family is `TW-T9 → TW-T10 → TW-T11 → TW-T12 → TW-T13 → BR-T2`, and it is **entirely on the Timeway side**: `TW-T9` schema adds `Organization`, `OrganizationMember`, `Team`/`TeamMember`, `OrgApiKey`, `Plan` models to *Timeway's* Prisma schema. This is the multi-tenant/org layer — it does not exist in Camv today and per the Bible's own sequencing was never meant to.
- **`GATE S10`** (the big pre-Phase-2 gate) explicitly lists "Camv room + token endpoint, MEDIA-1 exposure" as a red-team surface to be checked — meaning Camv is expected to be reviewed for security at that gate, but that gate has not fired yet (it comes after `Q-TW-B` → `Q-S6..S9` → `CC 1–21 green`).
- **No PART Q ticket currently exists for**: Camv admin dashboard, Camv multi-tenant/org model, Camv landing page, Camv call-quality/UX overhaul, Camv recording/transcription UX. All of this session's work (and the two prior sessions') was done as direct instruction from Ahmed, not as ticket-driven Bible work.

**Conclusion carried into this report:** the correct architectural path per the Bible is for Camv to *consume* Timeway's org layer once `TW-T9` lands (tenant ownership, recording ownership, dashboards keyed off Timeway's `Organization`/`OrganizationMember`), not to build a parallel auth/tenant system inside the Camv repo. Ahmed has agreed to hold Camv's admin-dashboard/multi-tenant ask pending an updated Bible from him.

---

## 3. Everything done in Camv, chronologically, with verification method

### Phase 0 — Bootstrap (2026-09-13, before v11.1 existed)
- `8a69d8e` Imported `livekit-examples/meet` (Apache-2.0 licensed LiveKit reference app) as the base codebase.
- `4c657e4` Removed the upstream repo's GitHub Actions CI (deploys via Coolify instead).

### Phase 1 — TW-T7: Timeway integration (2026-09-14)
- `e24dc3d` Booking-aware token endpoint — `/api/booking-connection-details` looks up a Timeway booking by UID and mints a scoped LiveKit token instead of an anonymous one.
- `b38dcf0` Added Dockerfile + Next.js `standalone` output for Coolify deployment.
- `e9096d9` Fixed broken git-lfs pointer files (images had been committed as LFS pointers, not real bytes — broke on a plain git clone).
- `bb9a354` Surfaced `booking-connection-details` errors to the user instead of a silent failure.
- `222bcc9` Removed the join time-window restriction (users could previously only join near the scheduled time).
- **Verified live:** HTTP checks against `camv.co` confirmed the booking-aware join flow worked end to end during this phase (session history).

### Phase 2 — Branding pass 1 (2026-09-14)
- `0b2eaab` Purged LiveKit Meet branding: swapped favicon, logo, Open Graph image for Camv's own assets.
- `85ca530` Restyled call UI controls (colors) to the Camv brand palette.
- **Verified live:** `curl` against `camv.co` confirmed page `<title>` and favicon byte-matched the new Camv assets (session history).

### Phase 3 — Branding pass 2 + recording/screenshare/codec (2026-09-15, early)
- `4665318` Removed remaining "LiveKit" text mentions from the public home page (a subagent-driven sweep).
- `59d95b2` Added `MobileScreenShareNotice` — explains why the screen-share button is absent on mobile instead of leaving it silently missing.
- `6a6ef96` Wired `RECORDING_S3_*` env vars in Coolify (pointed at the existing R2 bucket `spenai-recordings`), added `/api/record/start` and `/api/record/status` endpoints, wrote `CAMV_TRANSCRIPTION_PLAN.md` (a plan only — no STT implementation, blocked on an API key).
- `512817a` Root-caused and fixed a self-inflicted regression: an earlier "hq" fix had set capture to full 4K (`h2160`) with VP9, which amplifies jitter sensitivity on any network with packet loss. Changed default codec to H.264 (near-universal hardware decode support) and capped "hq" resolution at 1080p instead of 4K.
- `f85cf62` Merged the screenshare-notice and recording branches into `main`.
- **Verified live:** confirmed deployed commit hash matched `f85cf62` via the Coolify API; hit `/api/record/start` and `/api/record/status` against the live container and got correct LiveKit API responses proving the S3 wiring actually worked, not just that the code compiled.

### Phase 4 — This session: quality-selector, blur fix, responsiveness, freeze fix, recording auth (2026-09-15, later)
All seven commits below, in order, each typechecked (`tsc --noEmit` clean) before commit, each pushed straight to `main`, and the branch deployed + container-freshness-verified live at least twice during this phase (after commit `f22b80d` and again after `92fa8d9`):

1. **`37275df`** — *Blur/virtual-background black-screen freeze, fixed.*
   Root cause (found by reading the actual npm package source for `@livekit/track-processors` 0.7.0 vs 0.8.0, not guessed): the old API applied WebGL2-based background effects with **no capability check**. On devices where WebGL2 context creation fails (common on iPads/older phones/some browsers under memory pressure), the effect pipeline broke silently — the camera track kept "publishing" to a canvas that never got painted, producing a black, frozen frame. Upgraded the package to 0.8.0 and rewrote `lib/CameraSettings.tsx` to call the new `supportsBackgroundProcessors()` check before offering blur/background-image buttons at all, plus a runtime try/catch that falls back to the plain camera feed if a processor fails mid-call instead of freezing.

2. **`97df4c5`** — *Auto/manual video quality selector, built from scratch.*
   Confirmed by code search that no such feature existed anywhere in the codebase before this. Added `lib/QualitySettings.tsx`, wired into a new "Video Quality" tab in Settings, using LiveKit's `RemoteTrackPublication.setVideoQuality()` API (Auto / High / Medium / Low), applied globally to all remote video tracks.

3. **`a65198d`** — *Settings panel made responsive on mobile/iPad.*
   Root cause found in LiveKit's own shipped CSS: `.lk-settings-menu-modal` is a fixed `min-width: 50vw; min-height: 50vh` floating box with **zero mobile breakpoints**. Added an override in `styles/globals.css` making it a full-screen sheet below 768px width, plus made the Settings tab row and content region properly scrollable (`styles/SettingsMenu.module.css`, `lib/SettingsMenu.tsx`).

4. **`f22b80d`** — *Button/control-bar restyle.*
   Changed call-control buttons from flat rectangles to genuine pill shapes (`border-radius: 9999px`) with soft shadows and hover-lift, and made the whole control bar read as one floating, semi-transparent rounded capsule. Grouped buttons (e.g. camera + device-menu chevron) now visually merge into one capsule instead of clashing as separate rectangles.
   **Verified visually, not just by code review:** joined a real test room in a local dev environment pointed at the live production LiveKit server (`wss://lk.camv.co`) with real, temporary API credentials, screenshotted the actual rendered control bar, and used a vision check to confirm the floating-pill-capsule appearance was really there on screen.

5. **`a3c3a63`** — *Screenshare investigation, documented as a genuine platform limitation.*
   Checked caniuse.com's live compatibility table (includes Safari 26.6/27, the newest releases as of this session) directly: **iOS Safari has zero `getDisplayMedia()` support on any version to date**, including the newest ones — this is not a gap that a newer iPadOS closes. Every other mobile browser (Chrome/Firefox/Samsung Internet on Android) reports the same "not supported." Also confirmed via research why native Zoom/Meet/Teams apps *do* support iPad screen-share despite this: they use iOS's `ReplayKit` Broadcast Upload Extension, a native-app-only API with no web equivalent — a website (which is what Camv is) structurally cannot reach it without shipping a separate native iOS app. Updated code comments to state this precisely instead of implying a future web-only fix is coming.

6. **`38aa995`** — *Video-freeze auto-recovery, addressing Ahmed's specific clue ("expand/minimize/maximize solved the freeze").*
   Traced the mechanism: resizing a video tile forces LiveKit's `AdaptiveStreamManager.updateDimensions()` to re-evaluate and re-request the desired simulcast layer from the SFU, which causes the SFU to push a fresh keyframe to the decoder — that's *why* a manual resize "fixes" a stuck decoder (consistent with server-log evidence from an earlier investigation showing packet loss and multi-second jitter spikes on the SFU). Built `lib/VideoFreezeWatchdog.tsx`: watches every remote video element via `requestVideoFrameCallback` (falls back to polling `currentTime` on browsers without it), and if an actively-subscribed, unmuted, visible-tab video stalls longer than 6 seconds, automatically toggles the track's subscription off then on — the same underlying signal a manual resize sends — so the picture recovers without the user touching anything.

7. **`92fa8d9`** — *Recording restricted to the meeting host, verified server-side.*
   The original imported template shipped this code comment verbatim: *"this implementation does not authenticate users and therefore allows anyone with knowledge of a roomName to start/stop recordings for that room ... DO NOT USE THIS FOR PRODUCTION PURPOSES AS IS."* Ahmed flagged this directly ("it should [not] be that anyone [can] stop and start the recording"). Fix, since Camv has no accounts/login system of its own: `booking-connection-details` now compares the joining participant's name against the Timeway booking's recorded host name/email; on a match it mints a short-lived signed HMAC "host proof" token (`lib/hostProof.ts`, reusing the `CAMV_INTERNAL_SECRET` already deployed in Coolify) scoped to that specific room. This flows through a new `HostContext` React provider; the Settings menu only shows the Recording tab to the matched host, and `/api/record/start` / `/api/record/stop` verify the proof server-side (timing-safe HMAC compare) before touching Egress — so hiding the UI button is not the only protection.
   **Verified live, not just by code review:** after deploying, sent real unauthenticated `curl` requests directly to `https://camv.co/api/record/start` and `.../stop` and confirmed both now return `HTTP 403 "Only the meeting host can start/stop a recording"` instead of silently succeeding.

**Every phase-4 commit passed `pnpm exec tsc --noEmit` with zero errors before being committed**, and the branch was pushed to `main` and redeployed via the Coolify API at two checkpoints in this phase, with live container-freshness (`docker ps` uptime) and HTTP 200 checks confirming each deploy actually landed.

---

## 4. What has NOT been done yet (explicitly, so nothing is silently dropped)

- Recording/transcript **automated delivery** to the Timeway booking owner (link-sharing) — not started. Requires a Timeway-side webhook/endpoint since Camv's egress job only knows a roomName + S3 key, not which booking or host email it belongs to.
- **Multi-language transcription** — not started at all; blocked on an STT provider decision + API key from Ahmed (Deepgram Nova-3 and OpenAI Whisper both discussed as options).
- **Screenshare device-matrix testing** across real iPad/iPhone/Android hardware and browser combinations — Ahmed asked for this explicitly; the desk-research above (caniuse.com) explains *why* it's absent everywhere on mobile, but no hands-on multi-device testing matrix has been run yet.
- **Deep Google Meet/Zoom/Teams-grade UX audit** — flagged by Ahmed as essential; not yet scoped or started. Planned as a feature-by-feature comparison audit before any code changes, not incremental CSS patching.
- **Commercial landing page for camv.co** and **admin dashboard with multi-tenant support** — explicitly paused per Ahmed's direction, pending an updated Bible; see §2 for why a standalone Camv-side multi-tenant system would conflict with the Bible's existing `Q-TW-B` (Timeway org layer) plan.
- Recording endpoint hardening beyond host-matching (e.g., true login-based auth) has not been done — the current fix is a name-match against Timeway's booking record, not a cryptographic identity/login system, because Camv has zero account infrastructure today.

---

## 5. Governance note for Gosi / next Bible revision

No PR/audit loop was used for any of the Camv work above — everything was pushed directly to `main` on `awasfie/camv` and deployed by the agent at Ahmed's direct instruction, since no PART Q ticket exists for this product yet. If/when Ahmed's updated Bible brings Camv formally into PART Q, this report is the closest thing to a paper trail of what shipped beforehand and should be reconciled against whatever ticket numbers get assigned retroactively.
