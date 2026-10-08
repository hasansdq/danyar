/**
 * Melipayamak (ملی پیامک) adapter — https://melipayamak.com.
 *
 * Official REST API (verified against the official Melipayamak REST webservice
 * + the melipayamak-api npm package source):
 *   POST https://rest.payamak-panel.com/api/SendSMS/SendSMS
 *        form-urlencoded { username, password, to, from, text, isFlash }
 *        → { Value: <RecId>, RetStatus: 1, StrRetStatus: "Ok" }
 *   POST https://rest.payamak-panel.com/api/SendSMS/BaseService   (pattern send)
 *        form-urlencoded { username, password, to, bodyId, text: [args] }
 *        → same response shape (RetStatus 1 = success)
 *   POST https://rest.payamak-panel.com/api/SendSMS/GetCredit
 *        form-urlencoded { username, password } → { Value: <credit>, RetStatus, StrRetStatus }
 *
 * Credentials: username + password (panel login), from (sender line number)
 * and optionally bodyId (کد متن/پترن خدماتی) + pattern arg name.
 *
 * CAPABILITY: custom-code. OTP delivery uses the pattern (BaseService) when
 * `bodyId` is configured — the code is passed as the first pattern argument
 * (template variable), which is the official "خدماتی" high-priority channel —
 * otherwise a simple SMS with the code embedded in the text.
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

const REST_BASE = "https://rest.payamak-panel.com/api/SendSMS";

interface MeliResponse {
  Value?: string | number;
  RetStatus?: number;
  StrRetStatus?: string;
}

export class MelipayamakProvider implements SMSProviderAdapter {
  readonly id = "melipayamak" as const;
  private readonly username: string;
  private readonly password: string;
  private readonly from: string;
  private readonly bodyId?: string;

  constructor(config: SMSProviderConfig) {
    this.username = config.secrets.username ?? "";
    this.password = config.secrets.password ?? "";
    this.from = config.fields.from ?? "";
    this.bodyId = config.fields.bodyId || undefined;
  }

  /** POST form-urlencoded credentials + params (the official REST contract). */
  private async post(path: string, params: Record<string, string>): Promise<{ ok: boolean; status: number; data: unknown; networkError?: string }> {
    const body = new URLSearchParams({
      username: this.username,
      password: this.password,
      ...params,
    });
    return fetchJson(`${REST_BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString(),
      timeoutMs: 15_000,
    });
  }

  /** Interpret the shared RetStatus/StrRetStatus response envelope. */
  private interpret(res: { ok: boolean; status: number; data: unknown; networkError?: string }, valueLabel: string):
    { ok: true; value?: string } | { ok: false; errorCode?: string; errorMessage?: string } {
    if (res.networkError) {
      return { ok: false, errorCode: res.networkError === "timeout" ? "timeout" : "network_error", errorMessage: persianError(res.networkError === "timeout" ? "timeout" : "network_error") };
    }
    if (!res.ok) {
      const code = httpErrorCode(res.status);
      return { ok: false, errorCode: code, errorMessage: persianError(code) };
    }
    const data = (res.data ?? {}) as MeliResponse;
    // RetStatus 1 / StrRetStatus "Ok" = accepted. RetStatus 11/12 = not enough credit.
    const ret = typeof data.RetStatus === "number" ? data.RetStatus : -1;
    if (ret === 1 || data.StrRetStatus === "Ok") {
      const value = data.Value !== undefined && data.Value !== null && data.Value !== "" ? String(data.Value) : undefined;
      return { ok: true, value };
    }
    if (ret === 11 || ret === 12) {
      return { ok: false, errorCode: "insufficient_credit", errorMessage: persianError("insufficient_credit") };
    }
    return {
      ok: false,
      errorCode: `ret_${ret}`,
      errorMessage: `سرویس ملی پیامک درخواست را رد کرد (${sanitizeErrorText(data.StrRetStatus) ?? `کد ${ret}`}).`,
    };
  }

  async sendOtp(phone: string, code: string): Promise<OtpSendResult> {
    if (this.bodyId) {
      // Pattern (خدماتی) send — the code is the pattern argument.
      const res = await this.post("BaseService", {
        to: phone,
        bodyId: this.bodyId,
        text: code,
      });
      const outcome = this.interpret(res, "recId");
      if (outcome.ok) return { ok: true, messageId: outcome.value };
      return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
    }
    // Simple send — code embedded in the message text.
    const text = `کد ورود شما: ${code}\nسامانه دانیار`;
    return this.sendSms(phone, text);
  }

  async sendSms(phone: string, text: string): Promise<SmsSendResult> {
    const res = await this.post("SendSMS", {
      to: phone,
      from: this.from,
      text,
      isFlash: "false",
    });
    const outcome = this.interpret(res, "recId");
    if (outcome.ok) return { ok: true, messageId: outcome.value };
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }

  async testConnection(): Promise<SmsSendResult> {
    const res = await this.post("GetCredit", {});
    const outcome = this.interpret(res, "credit");
    if (outcome.ok) {
      return {
        ok: true,
        detail: typeof outcome.value === "string" ? `موجودی پنل: ${outcome.value}` : "اتصال موفق بود.",
      };
    }
    return { ok: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
  }
}
