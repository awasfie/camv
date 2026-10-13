# Camv data flows (WC-CV-3 step 3)

Inventory of every place a Camv meeting's personal data goes, for counsel under
R3-30 (Egypt PDPC transfer authorisation, KSA SDAIA SCC + Article 8 assessment)
and for the UAE/Egypt/KSA consent texts in `camv-consent-texts.md`.

Prepared by: Simon (builder), 2026-10-13. Status: draft for counsel; not legal
advice. Every location line below carries how it was verified.

## 1. Controller and processors

| Role                             | Party                                                                                       | Notes                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Controller (meeting data)        | The customer organisation (the Camv workspace that booked the meeting)                      | Decides to record; sets retention (UX.6: 30/90/365 days within plan) |
| Processor                        | AWSTREAMS DMCC (Camv)                                                                       | Operates the service below on the customer's instructions            |
| Sub-processor                    | Contabo GmbH                                                                                | Servers: media (MEDIA-1) and application/database (NEW_SERVER)       |
| Sub-processor                    | Cloudflare, Inc.                                                                            | R2 object storage (recordings), TURN relay, DNS/proxy                |
| Sub-processor (planned, WC-CV-6) | One STT vendor chosen by the WC-CV-6 bake-off: Speechmatics, Deepgram, ElevenLabs or Munsit | Not active today: no transcription runs in production                |
| Sub-processor (planned, WC-CV-7) | LLM vendor for summaries (Anthropic is the program's LLM vendor)                            | Not active today                                                     |
| Sub-processor                    | Functional Software, Inc. (Sentry)                                                          | Error telemetry; no media, no consent rows                           |

## 2. Flows

| #   | Data                                                                                                                                                         | From → to                                                                                   | Location                                                                                    | Retention                                                                                                           | Verified by                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| F1  | Live audio/video (WebRTC, DTLS-SRTP)                                                                                                                         | Participant browser → LiveKit SFU on MEDIA-1 (164.68.125.9)                                 | Contabo, Lauterbourg FR (Contabo EU region; the Bible's "media DE" line)                    | Not stored; forwarded to other participants only                                                                    | `ipinfo.io/164.68.125.9` → "Lauterbourg FR, AS51167 Contabo GmbH" (2026-10-13)                                          |
| F2  | Live media when UDP is blocked                                                                                                                               | Browser → Cloudflare TURN (per-participant credentials, WC-CV-2) or LiveKit TURN on MEDIA-1 | Cloudflare anycast (nearest PoP, may be in-country) / Contabo FR                            | Not stored; relayed only                                                                                            | WC-CV-2 code (`lib/turnCredentials.ts`)                                                                                 |
| F3  | Recording (composite MP4)                                                                                                                                    | LiveKit Egress on MEDIA-1 → Cloudflare R2 bucket `spenai-recordings`                        | R2 location hint EEUR (Eastern Europe), jurisdiction "default" (not EU-jurisdiction-locked) | Per plan: Pro 30 days, Business 365 days or the org's 30/90/365 setting; deleted by the retention job (§4)          | Cloudflare API `GET /r2/buckets/spenai-recordings` → `location: EEUR, jurisdiction: default` (2026-10-13)               |
| F4  | Consent record (`consent_events`): room, participant id, identity, display name, org, country, purpose, decision, language, text version, timestamp          | Camv app → Camv Postgres on NEW_SERVER (62.171.141.202)                                     | Contabo, Lauterbourg FR                                                                     | Kept as evidence of consent for the life of the workspace; append-only (database trigger refuses edits and deletes) | `ipinfo.io/62.171.141.202` → "Lauterbourg FR, AS51167 Contabo GmbH"; migration `db/migrations/0001_wc_cv_3_consent.sql` |
| F5  | Recording register + deletion log (`camv_recordings`, `camv_recording_deletions`): object key, start time, retention, consented identities, deletion outcome | Camv app → Camv Postgres (NEW_SERVER)                                                       | Contabo FR                                                                                  | Life of the workspace (it proves deletion)                                                                          | same migration                                                                                                          |
| F6  | Booking data (host email, attendee names, booking times)                                                                                                     | Timeway → Camv token endpoint (server to server, shared secret)                             | Timeway on NEW_SERVER, Contabo FR                                                           | Timeway's retention; Camv keeps only the room→org binding (`camv_rooms`)                                            | `app/api/booking-connection-details/route.ts`                                                                           |
| F7  | Transcript (planned)                                                                                                                                         | Recording audio → STT vendor (WC-CV-6) → R2                                                 | Vendor-dependent; US or EU processing; Munsit for the KSA residency tier (WC-CV-11)         | Same retention as the recording                                                                                     | Not live; recorded here so the consent text already covers it                                                           |
| F8  | Summary (planned)                                                                                                                                            | Transcript → LLM vendor (WC-CV-7) → SalesOS timeline/CRM note                               | Vendor-dependent (US processing likely)                                                     | SalesOS record retention                                                                                            | Not live                                                                                                                |
| F9  | Error telemetry                                                                                                                                              | Browser/server → Sentry                                                                     | Sentry SaaS                                                                                 | Sentry plan retention (90 days default)                                                                             | `NEXT_PUBLIC_SENTRY_DSN` set on the camv app                                                                            |

## 3. Cross-border transfers by participant country

All three jurisdictions see an outbound transfer for F1, F3, F4 and F5 (France /
EU) and, once WC-CV-6/7 ship, F7/F8 (vendor country).

- KSA (PDPL + Transfer Regulation): transfer basis = SCCs (SDAIA standard
  contractual clauses) with the Article 8 risk assessment; consent is the basis
  for the recording itself. R3-30 (a) files the SCC; until then recordings of
  KSA orgs run under consent with the transfer disclosed in the banner.
  KSA-resident storage is WC-CV-11 (residency tier, not R2).
- UAE (Federal Decree-Law 45/2021 PDPL; Penal Code privacy articles on
  recording conversations): all-party consent before recording, which the gate
  enforces in code (CC-70). Outbound transfer disclosed in the banner.
- Egypt (Law 151/2020): explicit consent plus a PDPC transfer licence for data
  leaving Egypt. Until R3-30 (a) is filed, default (b) is in force: recording is
  disabled in code for Egypt-country orgs (`RECORDING_BLOCKED_COUNTRIES`), and an
  org setting cannot override it.

## 4. Retention and deletion (WC-CV-3 step 2)

- Each recording is registered in `camv_recordings` at start with
  `delete_after = started_at + retention_days`. If the register write fails the
  egress is stopped, so no unregistered recording exists.
- A daily job (`POST /api/internal/retention`) deletes exactly the registered
  object keys that are due (never a bucket sweep), confirms with a HEAD that the
  object is gone, and writes one row per attempt to `camv_recording_deletions`.
  Failed deletions stay due and are retried next run.
- The deletion log is exportable per org: `GET /api/org/:id/consent-export?type=deletions`.

## 5. Data-subject requests

- Access: `GET /api/org/:id/consent-export` (CSV of every consent decision) and
  the deletion log; the customer (controller) answers the participant.
- Withdrawal: a participant may decline at any time by leaving; a declined
  participant cannot publish while anything is being captured.

## 6. Open items for counsel (R3-30)

1. Egypt PDPC permit naming France/EU (Contabo) and the R2 location; STT/LLM
   vendor countries once WC-CV-6/7 choose them.
2. KSA SCC filing + Article 8 assessment covering F1, F3–F5, F7, F8.
3. Review of the consent texts in `camv-consent-texts.md` (EN and AR), including
   whether "Europe" is a sufficient location disclosure.
4. Whether R2 should be locked to the EU jurisdiction (today: location hint
   EEUR, jurisdiction default). Changing it needs a new bucket; engineering can
   do it on request.
