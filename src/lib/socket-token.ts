/**
 * Socket.IO authentication tokens (short-lived HS256 JWTs).
 *
 * Issued by the Next.js app (`/api/socket/token`) ONLY to users with a valid
 * NextAuth session, and verified by the socket.io mini-services
 * (chat-service / classroom-service) using the shared SOCKET_AUTH_SECRET.
 *
 * This replaces the old "client sends userId" scheme, which allowed identity
 * spoofing (anyone knowing/guessing a userId could impersonate that user).
 *
 * Implementation: minimal compact JWS (HS256) built on node:crypto — no
 * external dependency, identical logic duplicated in each mini-service
 * (they are independent packages).
 */
import { createHmac, timingSafeEqual } from "crypto";
import { getSocketAuthSecret } from "@/lib/env";

const SOCKET_TOKEN_TTL_SECONDS = 300; // 5 minutes
const SOCKET_TOKEN_AUDIENCE = "daniyar-socket";

export interface SocketTokenPayload {
  /** user id (subject) */
  sub: string;
  role: string;
  username: string;
  schoolId: string | null;
  iat: number;
  exp: number;
  aud: string;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

/** Sign a socket token for the given user identity. */
export function signSocketToken(identity: {
  id: string;
  role: string;
  username: string;
  schoolId: string | null;
}): { token: string; expiresIn: number } {
  const secret = getSocketAuthSecret();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: SocketTokenPayload = {
    sub: identity.id,
    role: identity.role,
    username: identity.username,
    schoolId: identity.schoolId ?? null,
    iat: now,
    exp: now + SOCKET_TOKEN_TTL_SECONDS,
    aud: SOCKET_TOKEN_AUDIENCE,
  };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(secret, `${head}.${body}`));
  return { token: `${head}.${body}.${sig}`, expiresIn: SOCKET_TOKEN_TTL_SECONDS };
}

/** Exported for tests/dev tooling. */
export function verifySocketToken(token: string): SocketTokenPayload | null {
  try {
    const secret = getSocketAuthSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts;
    // Reject alg confusion: header must be exactly HS256.
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
    if (header?.alg !== "HS256") return null;
    // Constant-time signature comparison.
    const expected = hmac(secret, `${head}.${body}`);
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
