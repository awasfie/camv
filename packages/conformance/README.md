# packages/conformance

Recurring conformance runs for camv. Today: **CC-68** (Bible v12.6 WC-CV-5, CC-21 made nightly).

## CC-68 nightly synthetic recording

`cc68-nightly-recording.mjs run` — room `syn-<YYYYMMDD>` (UTC), two headless publishers
(rtc-node, 440 Hz and 660 Hz tones), one **track egress** per publisher straight to R2,
60 s of media, then for each track:

| check           | pass                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| egress complete | `EGRESS_COMPLETE`, no error                                                         |
| egress ended    | `EgressInfo.endedAt` (what the `egress_ended` webhook carries) within 120 s of stop |
| R2 object       | HEAD size == egress-reported size                                                   |
| signed download | full GET through a SigV4 presigned URL, byte count == R2 size                       |
| checksum        | sha256 of the downloaded file, stored in `result.json`                              |
| duration        | ffprobe 60 ± 2 s                                                                    |
| audio present   | ≥ 1 audio stream and ffmpeg `volumedetect` mean > −45 dB (tone ≈ −15 dB)            |

Objects: `s3://$RECORDING_S3_BUCKET/conformance/cc68/<room>/{pub-a.ogg,pub-b.ogg,result.json}`.
Keys are per night, so the streak (30 consecutive passes before paid acquisition) is read by key,
never by listing. The camv retention job deletes only keys held in `camv_recordings`, so this prefix
is not swept; nothing here deletes.

Failure or could-not-run → POST to the Q-OB Telegram route (`n8n.awstreams.chat/webhook/g3-alert`,
same as the G-3 poller) in the same run, i.e. well inside CC-68's 5 minutes.

Other modes (read-only): `verify syn-YYYYMMDD` re-downloads and re-checks a stored night
(checksum unchanged, LiveKit egress record while it is still kept); `ledger [n]` prints the
`docs/cc-status.md` rows for the last n nights.

Env: camv's own `LIVEKIT_*` and `RECORDING_S3_*` (D-R51). Dev only: `CC68_ROOM`, `HOLD_SECONDS`,
`CC68_NO_PAGE=1`.

## Schedule

`cc68-nightly-cron.sh` on the camv host (62.171.141.202), root crontab `15 1 * * *` (05:15 GST):
reads the env from the running camv container by name into a 0600 temp file (removed on exit),
builds `camv-conformance:<content-hash>` from this folder when missing, runs it, logs to
`/var/log/camv-cc68.log`. Install = copy this folder to `/opt/camv-conformance/` and add the line.

## Tests

`lib.test.mjs` (vitest, in the repo `pnpm test`): naming, SigV4, ffprobe/volumedetect parsing,
each failure mode of the verdict, streak, ledger row.
