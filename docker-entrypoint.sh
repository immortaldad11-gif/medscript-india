#!/bin/sh
set -e

# Apply any pending database migrations before starting the server. Idempotent — a
# fresh database gets the full schema; an up-to-date one is a no-op. Safe across
# multiple replicas (Prisma takes an advisory lock). Requires DATABASE_URL.
echo "[entrypoint] prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy

echo "[entrypoint] starting Next.js server"
exec node server.js
