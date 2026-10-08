# ============================================================
# Dockerfile — Next.js app (Bun-based, production)
# Multi-stage: builder → runner (minimal, hardened, non-root)
#
# Build args:
#   DB_PROVIDER=sqlite (default) | postgres
#     - sqlite   : image uses prisma/schema.prisma + prisma/migrations
#     - postgres : image uses prisma/schema.postgres.prisma +
#                  prisma/migrations-pg (swapped at build time)
# ============================================================

ARG BUN_IMAGE=oven/bun:1-debian

# ---------------- Stage 1: Build ----------------
FROM ${BUN_IMAGE} AS builder
ARG DB_PROVIDER=sqlite
WORKDIR /app

# Install dependencies — STRICT frozen lockfile (reproducible builds; a
# missing/out-of-sync lockfile must fail the build, never silently resolve).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source (NO .env — secrets are provided at runtime)
COPY . .

# Database provider swap (postgres builds use the postgres schema +
# postgres-dialect migrations). Done BEFORE `prisma generate` so the client
# engine matches the provider.
RUN if [ "$DB_PROVIDER" = "postgres" ]; then \
      cp prisma/schema.postgres.prisma prisma/schema.prisma && \
      rm -rf prisma/migrations && \
      cp -r prisma/migrations-pg prisma/migrations && \
      echo "[build] using PostgreSQL schema + migrations"; \
    else \
      echo "[build] using SQLite schema + migrations"; \
    fi

# Generate Prisma client (linux-debian query engine, correct provider)
RUN if [ "$DB_PROVIDER" = "postgres" ]; then export DATABASE_URL=postgresql://build:build@localhost:5432/build; else export DATABASE_URL=file:/tmp/build.db; fi; bunx prisma generate

# Build Next.js (standalone output — next.config.ts has output: "standalone").
# SECURITY: next.config.ts has typescript.ignoreBuildErrors=false — the build
# FAILS on any TypeScript error (it was previously true, letting type errors
# ship to production).
# `--bun` forces the Bun runtime for node_modules/.bin scripts — the
# oven/bun image ships no Node.js.
RUN if [ "$DB_PROVIDER" = "postgres" ]; then export DATABASE_URL=postgresql://build:build@localhost:5432/build; else export DATABASE_URL=file:/tmp/build.db; fi; \
    NEXTAUTH_SECRET=build-only-placeholder-never-used-at-runtime \
    SOCKET_AUTH_SECRET=build-only-placeholder-never-used-at-runtime bun --bun run build

# ---------------- Stage 2: Production runtime ----------------
FROM ${BUN_IMAGE} AS runner
ARG DB_PROVIDER=sqlite
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Default DB path — docker-compose mounts the db_data volume at /data/db.
# (PostgreSQL deployments override DATABASE_URL at runtime.)
ENV DATABASE_URL=file:/data/db/custom.db
# Upload directory — on the persistent uploads volume
# (docker-entrypoint.sh symlinks public/uploads → /data/uploads)
ENV UPLOAD_DIR=/data/uploads

# --- SECURITY: run as an unprivileged user (never root) ---
RUN groupadd -r -g 10001 appuser && useradd -r -u 10001 -g appuser -s /usr/sbin/nologin appuser

# Copy standalone Next.js server (already includes .next/static + public
# thanks to the "cp" steps inside `bun run build` in the builder stage).
COPY --from=builder --chown=appuser:appuser /app/.next/standalone ./

# Copy Prisma client + CLI + schema + MIGRATIONS
# (docker-entrypoint.sh runs `prisma migrate deploy` — no db push, no
# --accept-data-loss in production).
COPY --from=builder --chown=appuser:appuser /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appuser /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=appuser:appuser /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=appuser:appuser /app/prisma ./prisma

# Copy seed script + its import (src/lib/password-policy.ts) + bcryptjs
# (for seeding the admin user on first boot)
COPY --from=builder --chown=appuser:appuser /app/scripts ./scripts
COPY --from=builder --chown=appuser:appuser /app/src/lib/password-policy.ts ./src/lib/password-policy.ts
COPY --from=builder --chown=appuser:appuser /app/node_modules/bcryptjs ./node_modules/bcryptjs

# Copy entrypoint
COPY --chown=appuser:appuser docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Data dirs on the persistent volumes, owned by the unprivileged user.
# Fresh named volumes inherit this ownership on first use.
RUN mkdir -p /data/db /data/uploads && chown -R appuser:appuser /data /app

# Healthcheck (runs as appuser) — dedicated /api/health endpoint:
# 200 = HTTP server + database reachable, 503 = DB degraded. The DB probe
# makes `service_healthy` gating (caddy + mini-services) reflect real
# availability, not just a listening socket.
# start-period 40s covers first-boot migrations + seeding (entrypoint runs
# BEFORE the server starts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER appuser

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "server.js"]
