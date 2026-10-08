import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16 proxy (formerly middleware) — security layer.
 *
 * Responsibilities:
 *  1. Security headers on every response (CSP, HSTS, nosniff, frame
 *     protection, referrer policy, permissions policy).
 *  2. CSRF protection for state-changing API requests (Origin / Sec-Fetch-Site
 *     checks) — NextAuth routes additionally keep their own CSRF tokens.
 *  3. IP-based rate limits for sensitive endpoints (login, OTP, global API).
 *
 * Runs on the Edge runtime — the rate-limit counters live in module scope
 * (single process; for multi-instance deployments move them to Redis).
 */

// ---------------------------------------------------------------------------
// In-memory rate limiter (fixed window)
// ---------------------------------------------------------------------------
interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  b.count += 1;
  return { ok: true, retryAfter: 0 };
}

// Cleanup expired buckets periodically.
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

function getIp(req: NextRequest): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
function applySecurityHeaders(res: NextResponse, req: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const isHttps =
    req.nextUrl.protocol === "https:" ||
    (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim() === "https";

  // CSP — 'unsafe-inline' kept for scripts because several UI libraries
  // inject inline scripts; nonce-based strict CSP is a documented future
  // hardening step. eval is only allowed in dev (Next.js dev runtime).
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self' blob: data: wss: ws:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Camera + microphone are required by the virtual classroom (WebRTC).
  res.headers.set(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isHttps) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return res;
}

// ---------------------------------------------------------------------------
// CSRF — Origin / Fetch-Metadata checks for state-changing API requests
// ---------------------------------------------------------------------------
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfOk(req: NextRequest): boolean {
  if (req.method === "OPTIONS") return true;
  if (!MUTATING.has(req.method)) return true;
  const path = req.nextUrl.pathname;

  // NextAuth's own endpoints use CSRF tokens; we still verify Origin below
  // (extra layer). Only /api/* is checked here — server actions and pages
  // have their own protections.
  if (!path.startsWith("/api/")) return true;

  // 1) Fetch Metadata: modern browsers send Sec-Fetch-Site — a FORBIDDEN
  //    header that page JavaScript cannot forge. The browser itself
  //    attests whether the request is same-origin/same-site, so when it
  //    does we trust it and skip the Origin↔Host comparison below:
  //    trusted reverse-proxy chains in front of the app (the preview
  //    gateway, TLS-terminating load balancers) legitimately rewrite
  //    Host / X-Forwarded-Host, and that comparison would otherwise
  //    produce FALSE "CSRF" rejections for perfectly legitimate browser
  //    requests (observed with the preview panel's rewriting proxy).
  //    An explicit cross-site value is always rejected.
  //    (Allowing same-site matches the SameSite=Lax cookie posture.)
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  if (fetchSite && fetchSite !== "none") return false;

  // 2) Legacy fallback (browser without Fetch-Metadata support, or a
  //    "none" top-level navigation): when an Origin header is present it
  //    must match one of the hosts reported by the proxy chain — ALL
  //    X-Forwarded-Host entries (proxies append) plus the final Host.
  //    (No Origin → non-browser client → no CSRF surface.)
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const hostNames = new Set<string>();
    const xfh = req.headers.get("x-forwarded-host");
    if (xfh) {
      for (const part of xfh.split(",")) {
        const h = part.trim().split(":")[0].toLowerCase();
        if (h) hostNames.add(h);
      }
    }
    const host = req.headers.get("host");
    if (host) {
      const h = host.split(":")[0].toLowerCase();
      if (h) hostNames.add(h);
    }
    if (hostNames.size === 0) return false;
    return hostNames.has(o.hostname.toLowerCase());
    // Scheme check skipped: http/https mismatch handled by deployment.
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rate limit table (per-IP)
// ---------------------------------------------------------------------------
function rateLimitFor(req: NextRequest): { ok: boolean; retryAfter: number } | null {
  cleanup();
  const ip = getIp(req);
  const path = req.nextUrl.pathname;
  const method = req.method;

  // Credential login: 10 attempts / minute / IP.
  if (method === "POST" && path === "/api/auth/callback/credentials") {
    return hit(`login:${ip}`, 10, 60_000);
  }
  // SMS OTP login verify: 10 / minute / IP.
  if (method === "POST" && path === "/api/auth/callback/sms") {
    return hit(`otp-login:${ip}`, 10, 60_000);
  }
  // OTP request (SMS send): 30 / hour / IP. Generous on purpose: behind the
  // sandbox/dev gateway every user can share ONE forwarded IP, and in TEST
  // MODE (code displayed on the login page) repeated retries are expected —
  // the strict anti-abuse limits (per-phone, active-OTP, one-time-use,
  // verify attempts) live in the route next to the OTP store.
  if (method === "POST" && path === "/api/auth/sms/request") {
    return hit(`otp-req:${ip}`, 30, 60 * 60 * 1000);
  }
  // Socket token: 30 / minute / IP (each page load fetches one).
  if (method === "GET" && path === "/api/socket/token") {
    return hit(`socktok:${ip}`, 30, 60_000);
  }
  // Global API budget: 300 requests / minute / IP.
  if (path.startsWith("/api/")) {
    return hit(`api:${ip}`, 300, 60_000);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proxy entry point
// ---------------------------------------------------------------------------
export default function proxy(req: NextRequest) {
  // Uploaded files: next.config.ts `headers()` already serves them with a
  // hard sandbox (CSP sandbox + forced download + nosniff + DENY). Applying
  // the page-level CSP here would WEAKEN that (script-src 'unsafe-inline'),
  // so /uploads/* bypasses the app-level header set entirely.
  if (req.nextUrl.pathname.startsWith("/uploads/")) {
    return NextResponse.next();
  }

  // 1) CSRF check
  if (!csrfOk(req)) {
    // Diagnostics: middleware-rejected requests are NOT logged by Next's
    // request logger, so log the relevant headers here to make gateway
    // misconfigurations diagnosable (origin/host as the proxy chain
    // delivered them — no secrets, safe to log).
    console.warn(
      `[csrf] rejected ${req.method} ${req.nextUrl.pathname}`,
      JSON.stringify({
        origin: req.headers.get("origin"),
        secFetchSite: req.headers.get("sec-fetch-site"),
        host: req.headers.get("host"),
        xForwardedHost: req.headers.get("x-forwarded-host"),
      }),
    );
    const res = NextResponse.json(
      { error: "درخواست بین‌سایتی (CSRF) رد شد" },
      { status: 403 },
    );
    return applySecurityHeaders(res, req);
  }

  // 2) Rate limits
  const rl = rateLimitFor(req);
  if (rl && !rl.ok) {
    const res = NextResponse.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید." },
      { status: 429 },
    );
    res.headers.set("Retry-After", String(Math.max(rl.retryAfter, 1)));
    return applySecurityHeaders(res, req);
  }

  // 3) Continue + attach security headers to the response.
  const res = NextResponse.next();
  return applySecurityHeaders(res, req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
