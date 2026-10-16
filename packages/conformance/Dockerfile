# CC-68 runner image: node 22 + ffmpeg/ffprobe + the two LiveKit SDKs pinned in package-lock.json.
# Built and run by cc68-nightly-cron.sh on the camv host; holds no secrets (env is passed at run time).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /conformance
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY lib.mjs cc68-nightly-recording.mjs ./
USER node
ENTRYPOINT ["node", "cc68-nightly-recording.mjs"]
CMD ["run"]
