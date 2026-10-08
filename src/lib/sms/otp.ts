/**
 * OTP CORE (Phase 37 — provider-based architecture).
 *
 * This module owns the ENTIRE OTP lifecycle and is COMPLETELY INDEPENDENT of
 * any SMS service (delivery lives in providers/* + provider-config.ts):
 *
 *  - GENERATION   — cryptographically random 6-digit codes.
 *  - STORAGE      — DB-backed (OtpCode table), ONLY as an HMAC-SHA-256 hash
 *                   keyed with a server secret. The plaintext code is NEVER
 *                   persisted to disk; a DB leak cannot reveal usable codes.
 *  - EXPIRY       — per-row `expiresAt`; the TTL is configurable in the
 *                   «مدیریت OTP» panel (default 120 seconds).
 *  - VERIFICATION — one-time-use, timing-safe hash comparison, max
 *                   OTP_MAX_VERIFY_ATTEMPTS failed attempts per code; managed
 *                   entries (OTPy) delegate the compare to the provider while
 *                   the one-time-use/expiry/attempt rules stay HERE.
 *
 * TEST-MODE DISPLAY CACHE: when test-code display is ON («مدیریت ورود کاربر»)
 * the login page must be able to RE-DISPLAY the still-active code after a page
 * refresh. Hash-only storage makes that impossible from the DB, so the
 * plaintext lives in an EPHEMERAL process-memory cache (globalThis — see the
 * dev-mode note below) used exclusively for that re-display. Nothing sensitive
 * is ever written to disk, and losing the cache (process restart) simply
 * issues a fresh code.
 *
 * The store is DB-backed, so it is shared across ALL route modules (the old
 * in-memory Map needed the globalThis trick because `next dev` compiles each
 * route as a separate bundle).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { getNextAuthSecret } from "@/lib/env";
import { getActiveProvider } from "./provider-config";

/** Max failed verification attempts per issued code. */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;

/** Default TTL (seconds) — the panel setting overrides this at issue time. */
export const DEFAULT_OTP_TTL_SECONDS = 120;

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * The HMAC key for code hashes. Priority: OTP_HASH_SECRET → NEXTAUTH_SECRET.
 * Both are server-side-only secrets; production should set OTP_HASH_SECRET
 * explicitly (rotating it invalidates all outstanding codes — that is the
 * safe behaviour).
 */
function getOtpHashSecret(): string {
  const dedicated = process.env.OTP_HASH_SECRET;
  if (dedicated && dedicated.length >= 16) return dedicated;
  return getNextAuthSecret();
}

/** HMAC-SHA-256(code, secret) as hex — the ONLY representation ever stored. */
export function hashOtpCode(code: string): string {
  return createHmac("sha256", getOtpHashSecret()).update(code).digest("hex");
}

/** Constant-time equality of two hex digests. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Generate a 6-digit OTP code (cryptographic randomness). */
export function generateOTP(): string {
  const arr = new Uint32Array(1);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(arr);
  } else {
    // Fallback (not cryptographic, but acceptable for non-prod).
    arr[0] = Math.floor(Math.random() * 0xffffffff);
  }
  const code = arr[0] % 1000000;
  return code.toString().padStart(6, "0");
}

// ---------------------------------------------------------------------------
// Test-mode plaintext display cache (memory ONLY — see file header)
// ---------------------------------------------------------------------------

interface DisplayCacheEntry {
  code: string;
  /** The DB row's createdAt (ms) this cache entry belongs to — detects
   *  overwrites/issuance from other requests so a stale code is never shown. */
  issuedAtMs: number;
  expiresAtMs: number;
}

const globalForOtp = globalThis as unknown as {
  __eduMessengerOtpDisplayCache?: Map<string, DisplayCacheEntry>;
};
const displayCache: Map<string, DisplayCacheEntry> =
  globalForOtp.__eduMessengerOtpDisplayCache ?? new Map<string, DisplayCacheEntry>();
globalForOtp.__eduMessengerOtpDisplayCache = displayCache;

function cacheKey(phone: string, purpose: string): string {
  return `${purpose}:${phone}`;
}

/** Remember the plaintext for test-mode re-display (NEVER in real mode). */
function rememberForDisplay(phone: string, purpose: string, code: string, issuedAt: Date, ttlSeconds: number): void {
  displayCache.set(cacheKey(phone, purpose), {
    code,
    issuedAtMs: issuedAt.getTime(),
    expiresAtMs: issuedAt.getTime() + ttlSeconds * 1000,
  });
}

// ---------------------------------------------------------------------------
// Issuance
// ---------------------------------------------------------------------------

export interface IssueOtpOptions {
  phone: string;
  /** The generated code. For managed providers omit it (provider issues its own). */
  code?: string;
  /** TTL in seconds (from the panel setting; default 120). */
  ttlSeconds?: number;
  purpose?: string;
  /** Delivering provider id ("test" in test-mode display-only issuance). */
  providerId?: string | null;
  /** Provider-side request id (OTPy request_id etc.). */
  requestId?: string | null;
  /** TRUE when the provider manages the code itself (codeHash stays empty). */
  managed?: boolean;
  /** Cache the plaintext for test-mode re-display? */
  forDisplay?: boolean;
}

export interface IssuedOtp {
  phone: string;
  purpose: string;
  code: string | null;
  expiresAt: Date;
  managed: boolean;
  providerId: string | null;
  requestId: string | null;
}

/**
 * Store (overwrite) the OTP row for (phone, purpose). Overwriting is the
 * intended semantics — a new request invalidates any previous code.
 */
export async function issueOTP(opts: IssueOtpOptions): Promise<IssuedOtp> {
  const purpose = opts.purpose ?? "login";
  const ttl = opts.ttlSeconds ?? DEFAULT_OTP_TTL_SECONDS;
  const managed = opts.managed ?? false;
  const code = opts.code ?? null;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const row = await db.otpCode.upsert({
    where: { phone_purpose: { phone: opts.phone, purpose } },
    update: {
      codeHash: managed || !code ? "" : hashOtpCode(code),
      expiresAt,
      attempts: 0,
      consumedAt: null,
      providerId: opts.providerId ?? null,
      requestId: opts.requestId ?? null,
    },
    create: {
      phone: opts.phone,
      purpose,
      codeHash: managed || !code ? "" : hashOtpCode(code),
      expiresAt,
      attempts: 0,
      providerId: opts.providerId ?? null,
      requestId: opts.requestId ?? null,
    },
    select: { createdAt: true },
  });

  // Test-mode display cache (plaintext in memory only, never persisted).
  if (opts.forDisplay && code) {
    rememberForDisplay(opts.phone, purpose, code, row.createdAt, ttl);
  } else {
    displayCache.delete(cacheKey(opts.phone, purpose));
  }

  // Opportunistic housekeeping — drop rows expired > 1h ago.
  db.otpCode
    .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } })
    .catch(() => undefined);

  return {
    phone: opts.phone,
    purpose,
    code,
    expiresAt,
    managed,
    providerId: opts.providerId ?? null,
    requestId: opts.requestId ?? null,
  };
}

// ---------------------------------------------------------------------------
// State queries
// ---------------------------------------------------------------------------

/** Does the phone have a live (non-expired, unconsumed) OTP? */
export async function hasActiveOTP(phone: string, purpose = "login"): Promise<boolean> {
  const row = await db.otpCode.findUnique({
    where: { phone_purpose: { phone, purpose } },
    select: { expiresAt: true, consumedAt: true },
  });
  if (!row) return false;
  return !row.consumedAt && row.expiresAt.getTime() > Date.now();
}

/**
 * TEST MODE ONLY — the still-active code for re-display on the login page,
 * or null when no display-cached code exists (issue a fresh one then).
 * Cross-checked against the DB row (same issuedAt) so an overwritten code is
 * never re-displayed.
 */
export async function getActiveOTPCode(phone: string, purpose = "login"): Promise<string | null> {
  const row = await db.otpCode.findUnique({
    where: { phone_purpose: { phone, purpose } },
    select: { createdAt: true, expiresAt: true, consumedAt: true },
  });
  if (!row || row.consumedAt || row.expiresAt.getTime() <= Date.now()) return null;
  const entry = displayCache.get(cacheKey(phone, purpose));
  if (!entry) return null;
  if (entry.issuedAtMs !== row.createdAt.getTime() || entry.expiresAtMs <= Date.now()) return null;
  return entry.code;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type VerifyFailReason =
  | "not_found"
  | "expired"
  | "too_many_attempts"
  | "wrong_code"
  | "provider_switched"
  | "provider_error";

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: VerifyFailReason; providerError?: string };

/**
 * Verify a submitted code (one-time-use).
 *
 *  - LOCAL codes (custom-code providers + test mode): timing-safe HMAC
 *    comparison against the stored hash; consumed immediately on success.
 *  - MANAGED entries (OTPy): the compare delegates to the ACTIVE provider
 *    (same provider id as issuance, else "provider_switched"). Consumption,
 *    expiry and attempt accounting remain HERE.
 */
export async function verifyOTP(phone: string, code: string, purpose = "login"): Promise<VerifyOutcome> {
  const row = await db.otpCode.findUnique({
    where: { phone_purpose: { phone, purpose } },
    select: {
      id: true,
      codeHash: true,
      expiresAt: true,
      attempts: true,
      consumedAt: true,
      providerId: true,
    },
  });
  if (!row || row.consumedAt) return { ok: false, reason: "not_found" };

  // Expired — delete + reject.
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.otpCode.delete({ where: { id: row.id } }).catch(() => undefined);
    displayCache.delete(cacheKey(phone, purpose));
    return { ok: false, reason: "expired" };
  }

  // Attempt cap reached — delete + reject (a NEW code must be requested).
  if (row.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await db.otpCode.delete({ where: { id: row.id } }).catch(() => undefined);
    displayCache.delete(cacheKey(phone, purpose));
    return { ok: false, reason: "too_many_attempts" };
  }

  const normalized = code.trim();

  // MANAGED entry — delegate the compare to the delivering provider.
  if (!row.codeHash) {
    const { adapter, providerId } = await getActiveProvider();
    if (!adapter || providerId !== row.providerId || !adapter.verifyManagedOtp) {
      // Provider switched off/away between issuance and verification — the
      // outstanding code can no longer be verified anywhere.
      await db.otpCode.delete({ where: { id: row.id } }).catch(() => undefined);
      displayCache.delete(cacheKey(phone, purpose));
      return { ok: false, reason: "provider_switched" };
    }
    const outcome = await adapter.verifyManagedOtp(phone, normalized);
    if (outcome.verified) {
      await db.otpCode.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      displayCache.delete(cacheKey(phone, purpose));
      return { ok: true };
    }
    if (outcome.ok === false && outcome.errorCode && outcome.errorCode !== "wrong_code") {
      // Provider-side failure (network/auth) — don't burn an attempt.
      return { ok: false, reason: "provider_error", providerError: outcome.errorMessage };
    }
    await db.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, reason: "wrong_code" };
  }

  // LOCAL code — timing-safe hash comparison.
  if (safeEqualHex(hashOtpCode(normalized), row.codeHash)) {
    await db.otpCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });
    displayCache.delete(cacheKey(phone, purpose));
    return { ok: true };
  }

  await db.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  return { ok: false, reason: "wrong_code" };
}

// ---------------------------------------------------------------------------
// Phone normalization (shared by every OTP touchpoint)
// ---------------------------------------------------------------------------

/** Normalize an Iranian phone number. First converts Persian/Arabic-Indic
 *  digits to Latin (common Persian-keyboard input), then strips the
 *  remaining non-digits and rewrites international prefixes (98…/0098…)
 *  to the domestic form. A 10-digit input without the leading 0 gets it
 *  prepended ("913652461" → "0913652461"). */
export function normalizePhone(phone: string): string {
  let p = toLatinDigits(phone).replace(/\D/g, "");
  if (p.startsWith("0098")) p = "0" + p.slice(4);
  if (p.startsWith("98") && p.length > 10) p = "0" + p.slice(2);
  if (p.length === 10 && !p.startsWith("0")) p = "0" + p;
  return p;
}

/** Map Persian (۰-۹) and Arabic-Indic (٠-٩) digits to Latin digits.
 *  Persian users frequently type phone numbers with a Persian keyboard —
 *  `\d` / `\D` only match ASCII digits, so without this conversion those
 *  digits would be STRIPPED and the phone would become "" → "invalid
 *  phone" → no test code displayed. */
const PERSIAN_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function toLatinDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => PERSIAN_DIGITS[d] ?? d);
}

/**
 * Validate that a phone number is an acceptable Iranian mobile number for
 * OTP login. Accepts BOTH:
 *  - the standard 11-digit form "09" + 9 digits (e.g. 09123456789), AND
 *  - the 10-digit form "09" + 8 digits (e.g. the owner-specified default
 *    superadmin number 0913652461).
 * The DB lookup is an exact match on the normalized string, so accepting
 * the shorter form has no security impact — it only widens which formats
 * are considered well-formed.
 */
export function isValidIranPhone(phone: string): boolean {
  const p = normalizePhone(phone);
  return /^09\d{8,9}$/.test(p);
}
