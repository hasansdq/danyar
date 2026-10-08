/**
 * Shared SMS provider contract (Phase 37 — provider-based OTP).
 *
 * ARCHITECTURE
 * ────────────
 * The OTP core (generation, hash storage, expiry, verification, rate
 * limiting — src/lib/sms/otp.ts) is COMPLETELY INDEPENDENT of delivery.
 * Each SMS service is an ADAPTER implementing this interface; the registry
 * (src/lib/sms/provider-registry.ts) maps provider ids → adapter factories.
 * Adding a 5th provider = one new adapter file + one registry entry — no
 * OTP-core change is ever required.
 *
 * CAPABILITY MODEL
 * ────────────────
 *  - "custom-code" providers (Melipayamak, Faraz SMS, SMS.ir) embed a code
 *    WE generated into their message/template — verification stays local
 *    (timing-safe hash compare in our DB).
 *  - "managed" providers (OTPy) generate + verify the code THEMSELVES via
 *    their API and accept no custom code. For those the adapter ignores the
 *    local `code` argument on send and exposes `verifyManagedOtp`; the core
 *    stores only a reference row (never a code) and delegates verification.
 *    Rate limiting, one-time-use, TTL and audit remain in OUR core either way.
 */

export type SMSProviderId = "otpy" | "melipayamak" | "faraz" | "smsir";

/** Result shape every adapter operation resolves to. */
export interface SmsSendResult {
  ok: boolean;
  /** Provider-side message/request id (NOT a secret; safe to log/display). */
  messageId?: string;
  /** Machine-readable error code for logs + panel display. */
  errorCode?: string;
  /** Sanitized human-readable error. MUST NEVER contain the OTP code or
   *  any credential value — it is stored in SmsDeliveryLog + shown to users. */
  errorMessage?: string;
  /** Optional extra info (e.g. remaining credit) — shown in the panel only. */
  detail?: string;
}

/** Result of an OTP delivery attempt. */
export interface OtpSendResult extends SmsSendResult {
  /** True when the provider issued its OWN code (managed model). */
  managed?: boolean;
  /** For managed results: the provider-stated TTL of its code (seconds). */
  ttlSeconds?: number;
}

/** Normalized, resolved credentials for one provider instance. */
export interface SMSProviderConfig {
  /** Non-secret, non-empty fields (line number, pattern id, …). */
  fields: Record<string, string>;
  /** Secret fields (api keys, passwords, usernames). */
  secrets: Record<string, string>;
}

/**
 * The adapter interface every SMS service implements.
 */
export interface SMSProviderAdapter {
  readonly id: SMSProviderId;

  /**
   * Deliver an OTP. Custom-code providers embed `code` in their message or
   * pattern/template; managed providers ignore it and issue their own code
   * (the result is flagged `managed: true` and carries their TTL).
   */
  sendOtp(phone: string, code: string): Promise<OtpSendResult>;

  /**
   * Send a plain-text SMS (announcements). OPTIONAL — managed OTP-only
   * services don't support arbitrary text. Callers must feature-check.
   */
  sendSms?(phone: string, text: string): Promise<SmsSendResult>;

  /**
   * Verify a MANAGED OTP (only meaningful for managed providers). Custom-code
   * providers never implement this — verification stays local.
   */
  verifyManagedOtp?(phone: string, code: string): Promise<SmsSendResult & { verified: boolean }>;

  /**
   * Lightweight connectivity + credential check. NEVER sends an SMS.
   * Typically reads the account credit/usage so the panel can show it.
   */
  testConnection(): Promise<SmsSendResult>;
}

/** Shared fetch-with-timeout helper for all adapters. */
export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; data: unknown; networkError?: string }> {
  const { timeoutMs = 15_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      data: null,
      networkError: aborted ? "timeout" : err instanceof Error ? err.message : "network_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Truncate + sanitize an arbitrary provider error message for LOGGING:
 *  caps length, strips control chars. Never feed raw credential-bearing
 *  request bodies here — adapters construct messages themselves. */
export function sanitizeErrorText(text: string | undefined | null, max = 300): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned || undefined;
}

/** Map an HTTP status to a machine-readable error code (shared by adapters). */
export function httpErrorCode(status: number): string {
  switch (status) {
    case 401:
    case 403:
      return "auth_failed";
    case 429:
      return "rate_limited";
    case 400:
      return "bad_request";
    case 404:
      return "not_found";
    default:
      return status >= 500 ? "provider_server_error" : `http_${status}`;
  }
}

/** Persian, user-facing messages for the shared machine-readable error
 *  codes. Adapters may add provider-specific messages on top. */
export const PERSIAN_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "احراز هویت سرویس پیامک ناموفق بود — کلید/نام کاربری و رمز را بررسی کنید.",
  rate_limited: "سرویس پیامک درخواست‌های بیش از حد مجاز را رد کرد. کمی بعد تلاش کنید.",
  bad_request: "درخواست ارسالی به سرویس پیامک نامعتبر بود — تنظیمات (خط/قالب) را بررسی کنید.",
  not_found: "آدرس/قالب مورد نظر در سرویس پیامک یافت نشد.",
  provider_server_error: "خطای داخلی سرویس پیامک. لطفاً بعداً تلاش کنید.",
  timeout: "پاسخی از سرویس پیامک دریافت نشد (مهلت درخواست به پایان رسید).",
  network_error: "ارتباط با سرویس پیامک برقرار نشد — اتصال شبکه را بررسی کنید.",
  insufficient_credit: "موجودی سرویس پیامک کافی نیست.",
  invalid_phone: "شماره موبایل برای سرویس پیامک معتبر نیست.",
};

/** Resolve a Persian user-facing message for an error code. */
export function persianError(code: string | undefined, fallback?: string): string {
  if (code && PERSIAN_ERROR_MESSAGES[code]) return PERSIAN_ERROR_MESSAGES[code];
  return fallback ?? "ارسال پیامک ناموفق بود. لطفاً مجدداً تلاش کنید.";
}
