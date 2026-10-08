/**
 * Faraz SMS (فراز اس‌ام‌اس / IPPanel) adapter — https://farazsms.com
 * (panel backend: ippanel.com).
 *
 * Official REST API v1 (verified against the official IPPanel Python SDK,
 * package `ippanel` — base URL https://api2.ippanel.com/api/v1/, auth via the
 * `apikey` header, unified response envelope { status, code, data, error_message }):
 *   POST sms/send/webservice/single     { sender, recipient: [...], message, description }
 *                                      → { data: { message_id } }            (simple send)
 *   POST sms/pattern/normal/send        { code, sender, recipient, variable: {...} }
 *                                      → { data: { message_id } }            (pattern send)
 *   GET  sms/accounting/credit/show     → { data: { credit } }                (account credit)
 * Success = HTTP 200/201 + code === 200 + empty error_message.
 *
 * Credentials: apiKey (panel "کلید API"), sender (شماره خط فرستنده) and
 * optionally patternCode (کد پترن) + patternArg (نام متغیر داخل پترن).
 *
 * CAPABILITY: custom-code. OTP delivery uses the pattern send when
 * `patternCode` is configured (code as the pattern variable — the official
 * high-priority "خدماتی" channel), otherwise a simple SMS.
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

const BASE_URL = "https://api2.ippanel.com/api/v1";

interface IpPanelResponse {
  status?: string;
  code?: number;
  data?: unknown;
  error_message?: unknown;
}

export class FarazSmsProvider implements SMSProviderAdapter {
  readonly id = "faraz" as const;
  private readonly apiKey: string;
  private readonly sender: string;
  private readonly patternCode?: string;
  private readonly patternArg: string;

  constructor(config: SMSProviderConfig) {
    this.apiKey = config.secrets.apiKey ?? "";
    this.sender = config.fields.sender ?? "";
    this.patternCode = config.fields.patternCode || undefined;
    this.patternArg = config.fields.patternArg || "code";
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /** Interpret the unified IPPanel response envelope. */
  private interpret(res: { ok: boolean; status: number; data: unknown; networkError?: string }):
    { ok: true; data?: unknown } | { ok: false; errorCode?: string; errorMessage?: string } {
    if (res.networkError) {
      const code = res.networkError === "timeout" ? "timeout" : "network_error";
      return { ok: false, errorCode: code, errorMessage: persianError(code) };
    }
    const body = (res.data ?? {}) as IpPanelResponse;
    const envelopeCode = typeof body.code === "number" ? body.code : res.status;
    const errMsg =
      typeof body.error_message === "string"
        ? body.error_message
        : body.error_message && typeof body.error_message === "object"
          ? sanitizeErrorText(JSON.stringify(body.error_message))
          : undefined;
    // Success: HTTP 2xx + envelope code 200 + no error_message (per official SDK).
    if (res.ok && envelopeCode === 200 && !errMsg) {
      return { ok: true, data: body.data };
    }
    let code: string;
    if (envelopeCode === 401 || envelopeCode === 403) code = "auth_failed";
    else if (envelopeCode === 422 || envelopeCode === 400) code = "bad_request";
    else if (envelopeCode === 429) code = "rate_limited";
    else if (envelopeCode >= 500) code = "provider_server_error";
    else code = httpErrorCode(res.status);
    return {
      ok: false,
      errorCode: code,
      errorMessage: errMsg ? `سرویس فراز اس‌ام‌اس: ${errMsg}` : persianError(code),
    };
  }

  async sendOtp(phone: string, code: string): Promise<OtpSendResult> {
    if (this.patternCode) {
      // Pattern send — { code, sender, recipient, variable: { <arg>: code } }.
      const res = await fetchJson(`${BASE_URL}/sms/pattern/normal/send`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          code: this.patternCode,
          sender: this.sender,
          recipient: phone,
          variable: { [this.patternArg]: code },
        }),
        timeoutMs: 15_000,
      });
      const outcome = this.interpret(res);
      if (outcome.ok) {
        const messageId = (outcome.data as { message_id?: unknown } | null)?.message_id;
        return { ok: true, messageId: messageId !== undefined ? String(messageId) : undefined };
      }
      return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
    }
    // Simple send — code embedded in the message text.
    const text = `کد ورود شما: ${code}\nسامانه دانیار`;
    return this.sendSms(phone, text);
  }

  async sendSms(phone: string, text: string): Promise<SmsSendResult> {
    const res = await fetchJson(`${BASE_URL}/sms/send/webservice/single`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        sender: this.sender,
        recipient: [phone],
        message: text,
        description: { summary: "daniyar announcement", count_recipient: "1" },
      }),
      timeoutMs: 15_000,
    });
    const outcome = this.interpret(res);
    if (outcome.ok) {
      const messageId = (outcome.data as { message_id?: unknown } | null)?.message_id;
      return { ok: true, messageId: messageId !== undefined ? String(messageId) : undefined };
    }
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }

  async testConnection(): Promise<SmsSendResult> {
    const res = await fetchJson(`${BASE_URL}/sms/accounting/credit/show`, {
      method: "GET",
      headers: this.headers(),
      timeoutMs: 15_000,
    });
    const outcome = this.interpret(res);
    if (outcome.ok) {
      const credit = (outcome.data as { credit?: unknown } | null)?.credit;
      return {
        ok: true,
        detail: typeof credit === "number" ? `موجودی پنل: ${credit}` : "اتصال موفق بود.",
      };
    }
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }
}
