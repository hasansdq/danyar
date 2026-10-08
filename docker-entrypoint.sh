#!/bin/bash
# ============================================================
# docker-entrypoint.sh — Next.js production container (runs as appuser)
#
# SECURITY:
#  - Secrets (NEXTAUTH_SECRET, SOCKET_AUTH_SECRET) are validated UP FRONT —
#    the container refuses to start without them (no fallbacks, ever).
#  - ADMIN_PASSWORD is REQUIRED in production (never generated, never printed).
#  - SEED_DEMO_DATA=true is FORBIDDEN in production — deployment stops.
#  - Database schema is managed EXCLUSIVELY with `prisma migrate deploy`.
#    NO `prisma db push`, NO `--accept-data-loss` in production.
#  - Migration failures are fatal; no automatic legacy baselining.
#  - Seeding is idempotent and retried on restart: a SiteSetting marker
#    (`seed_completed`) is written only after a fully successful seed, so a
#    crashed seed re-runs on the next container start WITHOUT duplicates.
# ============================================================
set -e

log() { echo "[entrypoint] $*"; }
fatal() {
  echo "[entrypoint] FATAL: $*" >&2
  exit 1
}

log "Starting Daniyar messenger..."

# ---------- 1) Secret validation (fail closed, no fallbacks) ----------
if [ -z "$NEXTAUTH_SECRET" ] || [ "${#NEXTAUTH_SECRET}" -lt 16 ]; then
  fatal "NEXTAUTH_SECRET is missing or shorter than 16 chars. Generate one with: openssl rand -base64 32"
fi
if [ -z "$SOCKET_AUTH_SECRET" ] || [ "${#SOCKET_AUTH_SECRET}" -lt 16 ]; then
  fatal "SOCKET_AUTH_SECRET is missing or shorter than 16 chars. It must be IDENTICAL in nextjs, chat-service and classroom-service. Generate one with: openssl rand -base64 32"
fi

# ---------- 2) Production-only guards ----------
if [ "${NODE_ENV:-production}" = "production" ]; then
  if [ -z "$ADMIN_PASSWORD" ]; then
    fatal "ADMIN_PASSWORD is required in production. Set it in .env — it is never generated or printed."
  fi
  if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
    fatal "SEED_DEMO_DATA=true is forbidden in production (demo users have known passwords). Remove it from .env and redeploy."
  fi
fi

# ---------- 3) Data directories ----------
mkdir -p /data/db /data/uploads

# Symlink public/uploads → /data/uploads so Next.js serves uploaded files
# from the persistent volume (creates the link if it doesn't exist).
if [ ! -L /app/public/uploads ]; then
  rm -rf /app/public/uploads 2>/dev/null || true
  ln -sf /data/uploads /app/public/uploads
  log "Linked /app/public/uploads → /data/uploads"
fi

# ---------- 4) Database migrations (migrate deploy ONLY) ----------
DB_PROVIDER="sqlite"
case "$DATABASE_URL" in
  postgresql://*|postgres://*) DB_PROVIDER="postgres" ;;
esac
log "Database provider: $DB_PROVIDER"

# Apply migrations; any error stops startup. Legacy DB baseline requires manual schema verification.
MIGRATE_LOG="$(mktemp)"
if ! bunx prisma migrate deploy >"$MIGRATE_LOG" 2>&1; then
  cat "$MIGRATE_LOG" # surface the actual error for diagnosis
  fatal "Migration failed. Imported legacy databases must be schema-verified and baselined manually; no migrations are automatically marked applied."
fi
rm -f "$MIGRATE_LOG"
log "Migrations applied."

# ---------- 5) Seeding (idempotent, restart-safe) ----------
# The seed writes a `seed_completed` SiteSetting marker ONLY at the very end
# of a fully successful run. Marker present → skip. Marker absent (fresh DB
# OR a previously crashed seed) → run the seed again; every record is
# created via upsert/guarded-create, so re-runs NEVER duplicate.
# A failed seed is FATAL: the container exits and restart: unless-stopped
# retries the whole entrypoint (migrate deploy is a no-op by then).
SEED_MARKER=$(DATABASE_URL="$DATABASE_URL" bun -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.siteSetting
  .findUnique({ where: { key: 'seed_completed' } })
  .then((r) => { console.log(r ? 'done' : 'pending'); return p.\$disconnect(); })
  .catch(() => { console.log('pending'); process.exit(0); });
" 2>/dev/null || echo "pending")

if [ "$SEED_MARKER" = "done" ]; then
  log "Seed already completed (marker present) — skipping."
else
  log "Seeding required (fresh database or incomplete previous seed)..."
  if bun run scripts/seed.ts; then
    log "Seed completed successfully."
  else
    fatal "Seed failed. The deployment stops here; the container will restart and retry the (idempotent) seed automatically."
  fi
fi

# ---------- 6) Start the Next.js server ----------
log "Starting Next.js server on port 3000..."
exec "$@"
