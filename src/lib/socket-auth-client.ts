"use client";

/**
 * Client-side socket.io authentication.
 *
 * Fetches a short-lived JWT from /api/socket/token (NextAuth-session-gated)
 * and hands it to the socket.io handshake as `auth: { token }`.
 *
 * The `auth` option accepts a CALLBACK which socket.io re-invokes on every
 * (re)connection attempt — so the token is transparently refreshed before
 * it expires, including across long-lived reconnect loops.
 */

type TokenCache = { token: string; fetchedAt: number; expiresIn: number };

let cache: TokenCache | null = null;
let inflight: Promise<string> | null = null;

/** Slop margin: fetch a fresh token 30s before the old one expires. */
const REFRESH_MARGIN_MS = 30_000;

export async function getSocketToken(): Promise<string> {
  if (cache && Date.now() - cache.fetchedAt < (cache.expiresIn * 1000 - REFRESH_MARGIN_MS)) {
    return cache.token;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/socket/token", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`socket token request failed: ${res.status}`);
      const data = (await res.json()) as { token?: string; expiresIn?: number };
      if (!data.token) throw new Error("socket token missing in response");
      cache = { token: data.token, fetchedAt: Date.now(), expiresIn: data.expiresIn ?? 60 };
      return data.token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Socket.io `auth` callback factory. Usage:
 *
 *   const socket = io("/?XTransformPort=3003", {
 *     auth: socketAuthCallback(),
 *     ...
 *   });
 *
 * On each connection attempt the token is fetched/refreshed and delivered to
 * the server in `handshake.auth.token`. The server-side io.use middleware
 * verifies the signature — a plain `userId` payload is no longer accepted.
 */
export function socketAuthCallback() {
  return (cb: (data?: Record<string, unknown>) => void) => {
    getSocketToken()
      .then((token) => cb({ token }))
      .catch(() => cb({}));
  };
}
