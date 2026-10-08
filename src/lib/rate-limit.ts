/**
 * Lightweight in-memory rate limiter (fixed-window with sliding cleanup).
 *
 * Suitable for single-server deployments (this project's target: one Linux
 * host + Docker). For multi-instance deployments move the counters to Redis.
 *
 * SECURITY properties:
 *  - key is fully controlled by the caller (e.g. `login:${ip}`, `otp:${phone}`,
 *    `upload:${userId}`, `ai:${userId}`)
 *  - never logs key contents that could contain secrets (keys are opaque ids)
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Periodically drop expired buckets so the map doesn't grow forever. */
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();
function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitOptions {
  /** Max allowed hits per window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Remaining hits in the current window. */
  remaining: number;
  /** ms until the window resets (0 when ok). */
  retryAfterMs: number;
}

/** Check + consume one hit for the given key. */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  cleanup(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfterMs: 0 };
  }
  if (b.count >= opts.limit) {
    return { ok: false, remaining: 0, retryAfterMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true, remaining: opts.limit - b.count, retryAfterMs: 0 };
}

/** Reset a bucket (e.g. after a SUCCESSFUL login — don't punish legit users). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Extract the client IP from proxy headers (Caddy sets X-Real-IP / X-Forwarded-For). */
export function getClientIp(req: Request): string {
  const h = req.headers;
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}
