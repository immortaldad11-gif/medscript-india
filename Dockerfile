# syntax=docker/dockerfile:1
# Multi-stage production image for the MedScript India web server (Next.js standalone).
# node:20-slim (Debian) is used instead of Alpine to avoid Prisma musl/OpenSSL engine
# pitfalls. The container applies pending DB migrations on startup (docker-entrypoint.sh),
# so single-image deploys (Render/Railway/etc.) come up with the schema in place.

# ---- deps: install all dependencies ----
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: generate the Prisma client + the standalone Next build ----
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# JWT/encryption secrets are read lazily, so the production build needs no runtime
# secrets — only a successful compile.
RUN npm run build

# ---- runner: minimal runtime serving the standalone server as a non-root user ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 nodejs \
    && useradd -u 1001 -g nodejs -m nextjs

# Next standalone bundle (includes a traced node_modules), static assets, and public dir.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Output tracing can miss the Prisma query engine — copy the generated client (.prisma)
# and the FULL @prisma scope (client, engines, plus the CLI's helpers: debug,
# get-platform, fetch-engine, …) and the prisma CLI itself, so both runtime queries and
# `migrate deploy` work. The schema + migrations are needed by migrate deploy.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Writable dir for the local storage driver + the persisted DSC signing keyring.
# Mount a persistent volume here in production (compose does) so the signing key and
# uploaded documents survive restarts — otherwise the keyring goes in-memory and every
# restart/replica signs under a different key. (Or use STORAGE_DRIVER=s3 + env-managed
# DSC keys, both of which the app supports, to avoid local persistence entirely.)
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000

# Liveness via the app's own health endpoint (returns 503 when the DB is down).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1 || exit 1

# Apply pending migrations, then start the standalone server (see docker-entrypoint.sh).
ENTRYPOINT ["./docker-entrypoint.sh"]
