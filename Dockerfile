FROM node:20-slim AS base

# ---- Dependencies ----
FROM base AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN corepack use pnpm@10.18.2 && pnpm install --frozen-lockfile

# ---- Build ----
FROM base AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack use pnpm@10.18.2 && pnpm run build

# ---- Runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# IMGSCAN-A2 (WC-PE-7 step 4, CC-93): the runtime only runs `node server.js` and
# `node scripts/*.mjs`, so it carries no package manager. Debian security updates
# are applied at build (perl-base, libgnutls30), and npm/npx/corepack/yarn are
# removed (npm bundles a vulnerable tar). Build stages keep corepack + pnpm.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules /opt/yarn-* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  && node -e "process.exit(0)"
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# D-R50-5: conformance scripts must be runnable from the built artifact itself
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# WC-CV-3: schema migrations, applied by `node scripts/db-migrate.mjs --apply`
COPY --from=builder --chown=nextjs:nodejs /app/db ./db

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
