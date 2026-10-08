/**
 * SMS.ir adapter — https://sms.ir.
 *
 * Official REST API v1 (verified against the official docs page
 * https://sms.ir/rest-api — unified envelope { status, message, data },
 * status 1 = success; auth via the X-API-KEY header):
 *   POST https://api.sms.ir/v1/send/verify
 *        { mobile, templateId, parameters: [{ name, value }] }
 *        → { status: 1, message: "موفق", data: { verifyId, cost } }   (OTP/template send)
 *   POST https://api.sms.ir/v1/send/bulk
 *        { lineNumber, messageText, mobiles: [...], sendDateTime: null }
 *        → { status: 1, message: "موفق", data: [...] }                (simple send)
 *   GET  https://api.sms.ir/v1/credit
 *        → { status: 1, message: "موفق", data: <decimal> }            (account credit)
 * HTTP status codes: 200 OK, 400 logical error, 401 auth, 429 rate limit, 500 unexpected.
 *
 * Credentials: apiKey (کلید API از پنل برنامه‌نویسان), lineNumber (خط اختصاصی),
 * and for OTP delivery templateId (شناسه قالب «ارسال سریع») + templateParam
 * (نام پارامتر کد داخل قالب — e.g. "Code").
 *
 * CAPABILITY: custom-code. OTP delivery ALWAYS uses the verify (template)
 * channel — it is the official high-priority service-code route that reaches
 * numbers with promotional-SMS filtering enabled. templateId + templateParam
 * are therefore REQUIRED for sendOtp on this provider.
 */

import {
  fetchJson,
  sanitizeErrorText,
  httpErrorCode,
  persianError,
  type SMSProviderAdapter,
  type SMSProviderConfig,
  type OtpSendResult,
  type SmsSendResult,
} from "./types";

const BASE_URL = "https://api.sms.ir/v1";

interface SmsIrResponse {
  status?: number;
  message?: string;
  data?: unknown;
}

export class SmsIrProvider implements SMSProviderAdapter {
  readonly id = "smsir" as const;
  private readonly apiKey: string;
  private readonly lineNumber: string;
  private readonly templateId?: string;
  private readonly templateParam: string;

  constructor(config: SMSProviderConfig) {
    this.apiKey = config.secrets.apiKey ?? "";
    this.lineNumber = config.fields.lineNumber ?? "";
    this.templateId = config.fields.templateId || undefined;
    this.templateParam = config.fields.templateParam || "Code";
  }

  private headers(): Record<string, string> {
    return {
      "X-API-KEY": this.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /** Interpret the unified SMS.ir { status, message, data } envelope. */
  private interpret(res: { ok: boolean; status: number; data: unknown; networkError?: string }):
    { ok: true; data?: unknown; message?: string } | { ok: false; errorCode?: string; errorMessage?: string } {
    if (res.networkError) {
      const code = res.networkError === "timeout" ? "timeout" : "network_error";
      return { ok: false, errorCode: code, errorMessage: persianError(code) };
    }
    if (!res.ok) {
      // HTTP 401/429/5xx carry no JSON body — map directly.
      const code = httpErrorCode(res.status);
      return { ok: false, errorCode: code, errorMessage: persianError(code) };
    }
    const body = (res.data ?? {}) as SmsIrResponse;
    if (body.status === 1) {
      return { ok: true, data: body.data, message: body.message };
    }
    // Logical error inside a 200 — message is safe to surface (sanitized).
    const msg = sanitizeErrorText(body.message);
    return {
      ok: false,
      errorCode: `status_${body.status ?? "unknown"}`,
      errorMessage: msg ? `سرویس SMS.ir: ${msg}` : persianError("bad_request"),
    };
  }

  async sendOtp(phone: string, code: string): Promise<OtpSendResult> {
    if (!this.templateId) {
      return {
        ok: false,
        errorCode: "missing_template",
        errorMessage: "برای ارسال کد تایید با SMS.ir باید «شناسه قالب» (Template ID) در تنظیمات این سرویس وارد شود.",
      };
    }
    const res = await fetchJson(`${BASE_URL}/send/verify`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        mobile: phone,
        templateId: Number(this.templateId) || this.templateId,
        parameters: [{ name: this.templateParam, value: code }],
      }),
      timeoutMs: 15_000,
    });
    const outcome = this.interpret(res);
    if (outcome.ok) {
      const verifyId = (outcome.data as { verifyId?: unknown } | null)?.verifyId;
      return { ok: true, messageId: verifyId !== undefined ? String(verifyId) : undefined };
    }
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }

  async sendSms(phone: string, text: string): Promise<SmsSendResult> {
    const res = await fetchJson(`${BASE_URL}/send/bulk`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        lineNumber: Number(this.lineNumber) || this.lineNumber,
        messageText: text,
        mobiles: [phone],
        sendDateTime: null,
      }),
      timeoutMs: 15_000,
    });
    const outcome = this.interpret(res);
    if (outcome.ok) {
      const packId = Array.isArray(outcome.data) ? (outcome.data[0] as unknown) : (outcome.data as { packId?: unknown } | null)?.packId;
      return { ok: true, messageId: packId !== undefined && packId !== null ? String(packId) : undefined };
    }
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }

  async testConnection(): Promise<SmsSendResult> {
    const res = await fetchJson(`${BASE_URL}/credit`, {
      method: "GET",
      headers: this.headers(),
      timeoutMs: 15_000,
    });
    const outcome = this.interpret(res);
    if (outcome.ok) {
      const credit = outcome.data;
      return {
        ok: true,
        detail: typeof credit === "number" || typeof credit === "string" ? `موجودی پنل: ${credit}` : "اتصال موفق بود.",
      };
    }
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }
}
