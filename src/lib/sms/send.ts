/**
 * OTP delivery orchestrator (Phase 37).
 *
 * Bridges the OTP core (otp.ts) with the ACTIVE provider adapter
 * (provider-registry/provider-config) and the delivery log. Every caller —
 * the login SMS flow (/api/auth/sms/request) and the panel's «ارسال OTP
 * آزمایشی» — goes through here so delivery + storage + logging behave
 * identically everywhere.
 *
 * The plaintext code leaves this module ONLY:
 *  - hashed into the OtpCode row (custom-code providers), or
 *  - returned to the caller when `forDisplay` is set (TEST MODE — the login
 *    page displays it), or
 *  - embedded in the provider request (never logged).
 */

import { generateOTP, issueOTP } from "./otp";
import { getActiveProvider, getOtpEngineSettings } from "./provider-config";
import { getProviderDef } from "./provider-registry";
import { logDelivery } from "./delivery-log";
import { persianError } from "./providers/types";

export interface DeliverOtpOptions {
  phone: string;
  /** "login" (SMS login flow) | "otp-test" (panel test send). */
  purpose?: "login" | "otp-test";
  /** TTL override (panel test uses the engine setting; kept explicit here). */
  ttlSeconds?: number;
  /** TEST MODE — cache + return the plaintext for the login-page display. */
  forDisplay?: boolean;
  /** Real (non-test) callers REQUIRE a working provider. */
  requireProvider?: boolean;
}

export interface DeliverOtpOutcome {
  /** An OTP row was issued (code stored hashed / managed reference stored). */
  issued: boolean;
  /** Delivery actually happened through the provider. */
  sent: boolean;
  /** Test-mode display code (ONLY present when forDisplay). */
  testCode?: string;
  /** "test" when issued without any provider (test-mode fallback). */
  providerId: string | null;
  /** Managed providers issue their own code. */
  managed: boolean;
  /** Effective validity of the issued row (seconds). */
  ttlSeconds: number;
  messageId?: string;
  errorCode?: string;
  /** Persian, user-facing error (never contains the code or credentials). */
  errorMessage?: string;
  detail?: string;
}

const NOT_CONFIGURED_ERROR = "سرویس پیامک پیکربندی نشده است. مدیر کل باید در بخش «مدیریت OTP» یک سرویس را فعال و تنظیم کند.";

/**
 * Generate (when needed), deliver through the active provider, store and
 * log one OTP for the phone. See the options for the test/real mode matrix.
 */
export async function deliverOtp(opts: DeliverOtpOptions): Promise<DeliverOtpOutcome> {
  const purpose = opts.purpose ?? "login";
  const settings = await getOtpEngineSettings();
  const configuredTtl = opts.ttlSeconds ?? settings.ttlSeconds;

  const { adapter, reason, providerId } = await getActiveProvider();

  // ── No usable provider ─────────────────────────────────────────────────
  if (!adapter) {
    // Test-mode fallback: display-only code, no SMS.
    if (opts.forDisplay) {
      const code = generateOTP();
      await issueOTP({
        phone: opts.phone,
        code,
        ttlSeconds: configuredTtl,
        purpose,
        providerId: "test",
        forDisplay: true,
      });
      return {
        issued: true,
        sent: false,
        testCode: code,
        providerId: "test",
        managed: false,
        ttlSeconds: configuredTtl,
      };
    }
    // Real mode / panel test: a provider is REQUIRED.
    return {
      issued: false,
      sent: false,
      providerId: null,
      managed: false,
      ttlSeconds: configuredTtl,
      errorCode: reason === "disabled" ? "provider_disabled" : reason === "not_configured" ? "not_configured" : "no_active_provider",
      errorMessage:
        reason === "disabled"
          ? "سرویس پیامک فعال‌شده در تنظیمات، غیرفعال است. مدیر کل باید وضعیت آن را در «مدیریت OTP» بررسی کند."
          : NOT_CONFIGURED_ERROR,
    };
  }

  // ── Managed provider (e.g. OTPy): the provider issues its own code ─────
  const isManaged = getProviderDef(adapter.id)?.managed ?? false;
  const startedAt = Date.now();
  if (isManaged) {
    const result = await adapter.sendOtp(opts.phone, "");
    const latencyMs = Date.now() - startedAt;
    await logDelivery({
      provider: adapter.id,
      phone: opts.phone,
      purpose: purpose === "otp-test" ? "otp-test" : "otp",
      ok: result.ok,
      messageId: result.messageId,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      latencyMs,
    });
    if (!result.ok) {
      return {
        issued: false,
        sent: false,
        providerId: adapter.id,
        managed: true,
        ttlSeconds: configuredTtl,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage ?? persianError(result.errorCode),
      };
    }
    // Honor the provider's own TTL when it is shorter than the configured one.
    const effectiveTtl = Math.max(30, Math.min(configuredTtl, result.ttlSeconds ?? configuredTtl));
    await issueOTP({
      phone: opts.phone,
      ttlSeconds: effectiveTtl,
      purpose,
      providerId: adapter.id,
      requestId: result.messageId ?? null,
      managed: true,
    });
    return {
      issued: true,
      sent: true,
      providerId: adapter.id,
      managed: true,
      ttlSeconds: effectiveTtl,
      messageId: result.messageId,
      detail: result.detail,
    };
  }

  // ── Custom-code provider: WE generate the code ────────────────────────
  const code = generateOTP();
  const result = await adapter.sendOtp(opts.phone, code);
  const latencyMs = Date.now() - startedAt;
  await logDelivery({
    provider: adapter.id,
    phone: opts.phone,
    purpose: purpose === "otp-test" ? "otp-test" : "otp",
    ok: result.ok,
    messageId: result.messageId,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    latencyMs,
  });

  if (!result.ok) {
    if (opts.forDisplay) {
      // Test mode: a delivery failure never blocks the displayable code.
      await issueOTP({
        phone: opts.phone,
        code,
        ttlSeconds: configuredTtl,
        purpose,
        providerId: "test",
        forDisplay: true,
      });
      return {
        issued: true,
        sent: false,
        testCode: code,
        providerId: "test",
        managed: false,
        ttlSeconds: configuredTtl,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage ?? persianError(result.errorCode),
        detail: result.detail,
      };
    }
    // Real mode: nothing was delivered — issue nothing.
    return {
      issued: false,
      sent: false,
      providerId: adapter.id,
      managed: false,
      ttlSeconds: configuredTtl,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage ?? persianError(result.errorCode),
    };
  }

  // Delivered — store the hash (and the display cache in test mode).
  await issueOTP({
    phone: opts.phone,
    code,
    ttlSeconds: configuredTtl,
    purpose,
    providerId: adapter.id,
    requestId: result.messageId ?? null,
    forDisplay: opts.forDisplay ?? false,
  });
  return {
    issued: true,
    sent: true,
    testCode: opts.forDisplay ? code : undefined,
    providerId: adapter.id,
    managed: false,
    ttlSeconds: configuredTtl,
    messageId: result.messageId,
    detail: result.detail,
  };
}

export { NOT_CONFIGURED_ERROR };
