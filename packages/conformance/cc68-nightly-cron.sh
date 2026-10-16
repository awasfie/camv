#!/bin/bash
# CC-68 nightly entrypoint (WC-CV-5). Host crontab on the camv host (62.171.141.202), e.g.
#   15 1 * * * /opt/camv-conformance/cc68-nightly-cron.sh
# 01:15 UTC = 05:15 GST, outside Gulf business hours.
#
# Env comes from the RUNNING camv container by name (D-R51: camv's own LiveKit and
# recording credentials), written to a 0600 temp file that is removed on exit; no value
# is logged. The runner pages the Q-OB Telegram route itself on fail / could-not-run;
# this wrapper pages only when it cannot start the runner at all.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="camv-conformance:$(sha256sum "$DIR/package-lock.json" "$DIR/lib.mjs" "$DIR/cc68-nightly-recording.mjs" "$DIR/Dockerfile" | sha256sum | cut -c1-12)"
LOG=/var/log/camv-cc68.log
ALERT_URL="https://n8n.awstreams.chat/webhook/g3-alert"
KEYS="LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET RECORDING_S3_ENDPOINT RECORDING_S3_BUCKET RECORDING_S3_ACCESS_KEY RECORDING_S3_SECRET_KEY RECORDING_S3_REGION"

page() {
  curl -fsS -m 20 -H 'content-type: application/json' -d "{\"emoji\":\"🔴\",\"title\":\"CC-68 nightly recording could not start\",\"message\":\"$1\",\"source\":\"cc68-nightly-cron\"}" "$ALERT_URL" >/dev/null || true
}

exec >>"$LOG" 2>&1
echo "=== $(date -u +%FT%TZ) cc68 start image $IMAGE"

CID=$(docker ps --filter name=cucdml7amfveflswxcjgzdmt --format '{{.ID}}' | head -1)
if [ -z "$CID" ]; then echo "no running camv container"; page "no running camv container on $(hostname)"; exit 2; fi

ENVF=$(mktemp); chmod 600 "$ENVF"; trap 'rm -f "$ENVF"' EXIT
docker exec "$CID" env | awk -F= -v keys="$KEYS" 'BEGIN{n=split(keys,k," ");for(i=1;i<=n;i++)w[k[i]]=1} ($1 in w)' >"$ENVF"
# dev-run overrides (never set by the crontab line)
for v in CC68_ROOM HOLD_SECONDS CC68_NO_PAGE; do [ -n "${!v:-}" ] && echo "$v=${!v}" >>"$ENVF"; done

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -q -t "$IMAGE" "$DIR" || { page "image build failed on $(hostname)"; exit 2; }
fi

docker run --rm --env-file "$ENVF" --name "cc68-$(date -u +%Y%m%d)" "$IMAGE" run | grep -v '"name":"lk-rtc"'
RC=${PIPESTATUS[0]}
echo "=== $(date -u +%FT%TZ) cc68 exit $RC"
exit "$RC"
