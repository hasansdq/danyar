# ============================================================
# Dockerfile — chat-service (Bun + socket.io, port 3003)
# Multi-stage, non-root, strict frozen lockfile.
#
# Build args:
#   DB_PROVIDER=sqlite (default) | postgres — selects the Prisma schema
#   variant used for `prisma generate` (provider/engine must match runtime).
# ============================================================

FROM oven/bun:1-debian AS builder
ARG DB_PROVIDER=sqlite
WORKDIR /app

# STRICT frozen lockfile — reproducible builds only.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY index.ts socket-auth.ts ./

# Copy Prisma schema (postgres builds swap in the postgres variant)
COPY prisma/schema.prisma prisma/schema.postgres.prisma* ./prisma/
RUN if [ "$DB_PROVIDER" = "postgres" ] && [ -f prisma/schema.postgres.prisma ]; then \
      cp prisma/schema.postgres.prisma prisma/schema.prisma; \
    fi
RUN bunx prisma generate

# ---------------- Runtime ----------------
FROM oven/bun:1-debian AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV DB_URL=file:/data/db/custom.db

# SECURITY: unprivileged user
RUN groupadd -r -g 10001 appuser && useradd -r -u 10001 -g appuser -s /usr/sbin/nologin appuser

COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/index.ts /app/socket-auth.ts ./
COPY --from=builder --chown=appuser:appuser /app/prisma ./prisma

RUN mkdir -p /data/db && chown -R appuser:appuser /data /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3003/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3003

CMD ["bun", "index.ts"]
