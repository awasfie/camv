# Camv Live Transcription — Technical Plan

Status: **proposal, not implemented**. This is the spec to review/approve before any
transcription code is written. No STT vendor API key exists yet for this deployment
— that is the primary blocker to building anything beyond this document.

## 1. Context

Camv is a self-hosted LiveKit deployment (`wss://lk.camv.co`, own LiveKit server +
Egress container on the MEDIA-1 box, `livekit-server-sdk` 2.18.0 already a
dependency). There is **no LiveKit Cloud**, so LiveKit Cloud's managed
"Transcription" API (built on their hosted Agents infrastructure) is not available
to us — anything we build has to run as our own process talking to LiveKit's
open-source APIs plus a third-party STT provider.

Two viable approaches, ordered by real-time value vs. effort:

## 2. Option A — Live transcription via LiveKit Agents + streaming STT (recommended target state)

**How it works:** LiveKit's open-source [Agents framework](https://docs.livekit.io/agents/)
lets a Node/Python worker process join a room as a special participant, subscribe to
every published audio track, stream the audio to a cloud STT API (Deepgram,
AssemblyAI, or OpenAI's realtime transcription), and publish the resulting
transcript back into the room as `RoomEvent.TranscriptionReceived` data (LiveKit
has first-class support for this via the `Transcription` track/data-channel
protocol that `@livekit/components-react`'s caption UI can consume directly).

**Infra required:**
- A new long-running worker process/container (`livekit-agents` npm package, or the
  Python `livekit-agents` SDK — Python has the more mature/maintained agents
  ecosystem as of today) deployed on or near the MEDIA-1 box, registered against
  `wss://lk.camv.co` with the same `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`.
- An STT provider API key. Recommended: **Deepgram** (has a purpose-built low-latency
  streaming API and an official LiveKit Agents plugin: `livekit-plugins-deepgram`).
  AssemblyAI's streaming API is a solid alternative with a similar cost profile.
  OpenAI's Realtime API can also do STT but is pricier per-minute and less
  purpose-built for this than Deepgram.
- Ahmed needs to provide: a Deepgram (or AssemblyAI) account + API key. Rough cost:
  Deepgram Nova-2 streaming is ~$0.0043–0.0059/min as of their published pricing —
  cheap at Camv's expected call volume, but a recurring third-party cost that
  didn't exist before.

**Integration steps (rough, ~3–5 days of engineering effort once a key exists):**
1. Stand up the agents worker as its own Coolify app (or a sidecar container next to
   `livekit-egress`/`livekit-server` on MEDIA-1), pointed at `lk.camv.co`.
2. Configure the Deepgram plugin with the new API key via env var
   (`DEEPGRAM_API_KEY`), have the worker auto-dispatch into every new room (LiveKit
   Agents supports "automatic dispatch" so it doesn't need per-room invitation code
   in Camv's Next.js app — it just needs to be registered against the same project).
3. On the Camv frontend, add a `TranscriptionTile`/captions overlay using
   `@livekit/components-react`'s existing transcription hooks
   (`useTrackTranscription` / the `Captions`-style components already shipped in
   recent `components-react` versions — need to confirm exact API surface against
   the pinned `2.9.24` version, may require a minor bump).
4. Add a toggle (similar to the recording button) so users can turn live captions
   on/off per call, and decide whether transcripts are ephemeral (UI-only) or
   persisted (see below).
5. Optional: persist the transcript (append to a text/JSON file per room, or push to
   a DB) if Ahmed wants searchable call transcripts after the fact, not just live
   captions during the call.

**Effort estimate:** 3–5 engineering days for a working live-captions MVP (worker +
frontend UI), assuming the API key is provided and no persistence/search layer is
required. Add 2–3 days if transcript persistence + a "view transcript after call"
UI is wanted.

**Risks/unknowns:**
- LiveKit Agents' Node.js SDK is younger/less battle-tested than the Python one;
  Python would mean introducing a second runtime into an otherwise all-Node
  infra — worth a deliberate decision, not a default.
- Multi-speaker diarization (labeling "who said what") needs either per-participant
  audio tracks fed to STT separately (straightforward in LiveKit, each track is
  already isolated per participant) or a diarization-capable STT mode — Deepgram
  supports this natively per-track, so this is actually the easier path in our
  setup versus a single merged-audio approach.

## 3. Option B — Post-call transcription of the Egress recording (simpler, lower value, ships fast)

**How it works:** After a call ends and the Egress recording lands in S3
(`RECORDING_S3_BUCKET`), a webhook or polling job downloads the finished `.mp4`,
extracts audio, and sends it to a batch STT API (OpenAI's Whisper API,
`whisper-1`/`gpt-4o-transcribe`, or a self-hosted `whisper.cpp`/`faster-whisper`
container) to get a full transcript, then stores/emails it.

**Infra required:**
- An OpenAI API key (or a self-hosted Whisper container — no external key needed but
  needs a GPU or tolerably-slow CPU inference box; MEDIA-1's specs would need
  checking for CPU-only Whisper feasibility at real-call durations).
- A small worker (could literally be a Next.js API route triggered by LiveKit's
  Egress **webhook** — `livekit-server-sdk` supports registering webhook URLs for
  `egress_ended` events — no separate polling process needed).

**Integration steps (~1–2 days):**
1. Register a webhook endpoint (`/api/webhooks/egress`) with the LiveKit server's
   webhook config (`webhook.urls` in `livekit.yaml`, needs a redeploy/restart of
   `livekit-server` on MEDIA-1 — a real infra change, not app-only).
2. On `egress_ended`, download the recording from S3/R2, call OpenAI's
   `audio.transcriptions` endpoint (or self-hosted Whisper), store the resulting
   transcript text (S3 alongside the recording, or a DB row) keyed by room/egress ID.
3. Surface the transcript in a simple UI (link/download on a "past recordings" page,
   which doesn't exist yet either and would need to be built regardless).

**Effort estimate:** 1–2 days once an OpenAI key (or self-hosted Whisper) is
available, since it's simpler orchestration (no live audio streaming, no new
long-running worker process, batch job on a finished file).

**Trade-off:** No live captions during the call — transcript is only available
after the meeting ends. Much lower engineering and infra risk than Option A.

## 4. Recommendation

- **Ship Option B first** if the goal is "have a transcript of the call available
  afterward" — it's a 1–2 day lift, reuses the recording pipeline we already
  verified is running, and only needs one API key (OpenAI) that's cheap and easy to
  provision.
- **Build Option A (LiveKit Agents + Deepgram) as a follow-up** if live in-call
  captions are actually the goal (e.g. accessibility, real-time note-taking) — it's
  a genuinely bigger lift (new always-on worker process, new runtime
  considerations, per-minute STT billing) and should be scoped as its own project
  once Option B validates that transcription is valuable to Ahmed's users at all.

## 5. What's needed from Ahmed before either can start

| Item | Needed for | Status |
|---|---|---|
| OpenAI API key (or decision to self-host Whisper) | Option B | **Not provided** |
| Deepgram or AssemblyAI API key | Option A | **Not provided** |
| Decision: persist transcripts? where (S3/DB)? | Both | Not decided |
| Decision: Node vs Python runtime for Agents worker | Option A only | Not decided |
| `livekit.yaml` webhook config change + `livekit-server` restart access | Option B | Requires MEDIA-1 SSH access (available to whoever holds `~/.hermes/keys/media1_*` — confirmed reachable during this task) |

No code has been written for either option. This document is the spec to approve
before implementation begins.
