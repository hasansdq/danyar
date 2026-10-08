/**
 * SMS delivery logging (Phase 37).
 *
 * Every outbound SMS attempt (OTP, test OTP, announcement, test-connection)
 * is recorded in SmsDeliveryLog with:
 *  - the MASKED recipient phone (PII-minimized: 0912***4567),
 *  - the provider, status, latency and sanitized error info.
 *
 * SECURITY — the OTP code, credentials, message bodies and full phone
 * numbers are NEVER written here. This module is the ONLY writer of the
 * table; keep that invariant when extending it.
 */

import { db } from "@/lib/db";

/** Mask an Iranian mobile for logging: 09123456789 → 0912***6789. */
export function maskPhone(phone: string): string {
  const p = phone.replace(/\D/g, "");
  if (p.length < 7) return "***";
  return `${p.slice(0, 4)}***${p.slice(-4)}`;
}

export interface DeliveryLogInput {
  provider: string;
  phone: string;
  purpose: "otp" | "otp-test" | "announcement" | "test-connection";
  ok: boolean;
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number;
}

/** Best-effort delivery-log write — never throws. */
export async function logDelivery(input: DeliveryLogInput): Promise<void> {
  try {
    await db.smsDeliveryLog.create({
      data: {
        provider: input.provider,
        phoneMasked: maskPhone(input.phone),
        status: input.ok ? "sent" : "failed",
        messageId: input.messageId?.slice(0, 200) || null,
        errorCode: input.errorCode?.slice(0, 100) || null,
        errorMessage: input.errorMessage?.slice(0, 500) || null,
        latencyMs: input.latencyMs ?? null,
        purpose: input.purpose,
      },
    });
  } catch (err) {
    console.error("[sms:delivery-log] failed to write:", err instanceof Error ? err.message : err);
  }
}

/** Panel status snapshot: last send time + last failure across providers. */
export interface DeliveryStatus {
  lastSendAt: string | null;
  lastError: {
    provider: string;
    errorCode: string | null;
    errorMessage: string | null;
    at: string;
  } | null;
}

/** Read the panel status (real SMS attempts only — connection tests excluded). */
export async function getDeliveryStatus(): Promise<DeliveryStatus> {
  try {
    const [lastSent, lastFailed] = await Promise.all([
      db.smsDeliveryLog.findFirst({
        where: { status: "sent", purpose: { in: ["otp", "otp-test", "announcement"] } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      db.smsDeliveryLog.findFirst({
        where: { status: "failed", purpose: { in: ["otp", "otp-test", "announcement"] } },
        orderBy: { createdAt: "desc" },
        select: { provider: true, errorCode: true, errorMessage: true, createdAt: true },
      }),
    ]);
    return {
      lastSendAt: lastSent?.createdAt?.toISOString() ?? null,
      lastError: lastFailed
        ? {
            provider: lastFailed.provider,
            errorCode: lastFailed.errorCode,
            errorMessage: lastFailed.errorMessage,
            at: lastFailed.createdAt.toISOString(),
          }
        : null,
    };
  } catch {
    return { lastSendAt: null, lastError: null };
  }
}

/** Recent delivery rows for the panel table. */
export async function getRecentDeliveryLogs(limit = 20) {
  try {
    return await db.smsDeliveryLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        provider: true,
        phoneMasked: true,
        status: true,
        messageId: true,
        errorCode: true,
        errorMessage: true,
        latencyMs: true,
        purpose: true,
        createdAt: true,
      },
    });
  } catch {
    return [];
  }
}
