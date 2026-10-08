/**
 * Socket.IO authentication for mini-services.
 *
 * Verifies the short-lived HS256 JWT issued by the Next.js app's
 * /api/socket/token endpoint (NextAuth-session-gated) using the shared
 * SOCKET_AUTH_SECRET. The OLD scheme (client-supplied `userId`) allowed
 * identity spoofing and is NO LONGER ACCEPTED.
 *
 * Secret handling:
 *  - SOCKET_AUTH_SECRET is REQUIRED (>= 16 chars) in EVERY environment —
 *    there is NO fallback secret in the code. When missing/weak the process
 *    exits immediately (fail-fast).
 *  - Dev provides the value via the mini-service .env file (must match the
 *    main app's .env).
 */
import { createHmac, timingSafeEqual } from "crypto";

const SOCKET_TOKEN_AUDIENCE = "daniyar-socket";

export function getSocketAuthSecret(): string {
  const secret = process.env.SOCKET_AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  console.error(
    "[socket-auth] FATAL: SOCKET_AUTH_SECRET is missing or too short (<16 chars) — exiting. " +
      "Generate one with: openssl rand -base64 32 — and pass the SAME value to nextjs, chat-service and classroom-service (via ENV / .env).",
  );
  process.exit(1);
}

export interface SocketTokenPayload {
  sub: string;
  role: string;
  username: string;
  schoolId: string | null;
  iat: number;
  exp: number;
  aud: string;
}

/** Verify a socket token. Returns the payload or null (invalid/expired/forged). */
export function verifySocketToken(token: unknown): SocketTokenPayload | null {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
    const secret = getSocketAuthSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts;
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    if (header?.alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
    const provided = Buffer.from(sig, "base64url");
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SocketTokenPayload;
    if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    if (payload.aud !== SOCKET_TOKEN_AUDIENCE) return null;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CORS / origin allowlist
// ---------------------------------------------------------------------------

/** Origins explicitly allowed to connect (SOCKET_ALLOWED_ORIGINS, comma separated). */
const ALLOWED_ORIGINS = (process.env.SOCKET_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Server-enforced origin check (CORS headers alone are browser-only).
 * Allowed when:
 *  - origin is in SOCKET_ALLOWED_ORIGINS, OR
 *  - origin host equals the request Host header (same-origin through the
 *    gateway — Caddy preserves Host), OR
 *  - localhost/127.0.0.1 origin AND not production (dev convenience).
 */
export function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // non-browser client (health checks, native apps)
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const o = new URL(origin);
    if (host) {
      const hostName = host.split(":")[0];
      if (o.hostname === hostName) return true;
    }
    if (
      process.env.NODE_ENV !== "production" &&
      (o.hostname === "localhost" || o.hostname === "127.0.0.1" || o.hostname === "[::1]")
    ) {
      return true;
    }
  } catch {
    // malformed origin — reject
  }
  return false;
}
