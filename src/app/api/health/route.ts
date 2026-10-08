/**
 * GET /api/health — dedicated health endpoint (public, unauthenticated).
 *
 * Used by:
 *  - the Next.js Docker HEALTHCHECK (see Dockerfile),
 *  - docker-compose `service_healthy` gating (caddy + mini-services wait for
 *    the app to be healthy),
 *  - external uptime probes.
 *
 * Response:
 *  - 200 { status: "ok", db: "up", ... }        — HTTP server + database OK
 *  - 503 { status: "degraded", db: "down", ... } — server up, database
 *    unreachable (container is marked unhealthy so orchestration can react)
 *
 * No sensitive information is exposed (no versions, no DB URLs, no counts).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DB_PROBE_TIMEOUT_MS = 3000;

export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("db probe timeout")), DB_PROBE_TIMEOUT_MS),
      ),
    ]);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const body = {
    status: dbOk ? "ok" : "degraded",
    db: dbOk ? "up" : "down",
    latencyMs: Date.now() - startedAt,
    uptimeSeconds: Math.floor(process.uptime()),
  };

  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
