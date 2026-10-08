/**
 * Centralized environment / secret management.
 *
 * SECURITY RULES:
 *  - A missing/weak secret (NEXTAUTH_SECRET, SOCKET_AUTH_SECRET) is a HARD
 *    ERROR in EVERY environment: the app refuses to boot / serve requests.
 *    There are NO fallback secrets in the code — the value must always come
 *    from process.env (ENV / secret management).
 *  - Dev environments provide real (dev-only) values via .env files, never
 *    via code-level fallbacks.
 */

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * NEXTAUTH_SECRET — signs/encrypts the NextAuth session JWT.
 * Required (>= 16 chars) ALWAYS. Generate: openssl rand -base64 32
 */
export function getNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  const scope = isProduction() ? "production" : "this environment";
  throw new Error(
    `[env] FATAL: NEXTAUTH_SECRET is missing or too short (<16 chars) — refusing to start in ${scope}. ` +
      "Generate one with: openssl rand -base64 32 — and set it via ENV/.env (never a code fallback).",
  );
}

/**
 * SOCKET_AUTH_SECRET — HMAC key shared between the Next.js app (issuer) and
 * the socket.io mini-services (verifier) for short-lived socket JWTs.
 * Required (>= 16 chars) ALWAYS, identical in all 3 services.
 */
export function getSocketAuthSecret(): string {
  const secret = process.env.SOCKET_AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  const scope = isProduction() ? "production" : "this environment";
  throw new Error(
    `[env] FATAL: SOCKET_AUTH_SECRET is missing or too short (<16 chars) — refusing to start in ${scope}. ` +
      "Generate one with: openssl rand -base64 32 — and pass the SAME value to nextjs, chat-service and classroom-service.",
  );
}
