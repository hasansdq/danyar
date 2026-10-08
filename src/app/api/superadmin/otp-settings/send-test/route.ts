import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import { getActiveProvider } from "@/lib/sms/provider-config";
import { deliverOtp } from "@/lib/sms/send";
import { normalizePhone, isValidIranPhone } from "@/lib/sms/otp";
import { rateLimit } from "@/lib/rate-limit";
import { getPrimarySuperadmin } from "@/lib/login-settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/superadmin/otp-settings/send-test
 * Body: { phone?: string }  — defaults to the superadmin's own SMS phone.
 *
 * Sends a REAL OTP through the ACTIVE provider (Phase 37) — an end-to-end
 * test of the whole chain: code generation → provider delivery → hashed
 * storage → delivery logging. The test code itself is NOT returned (it
 * behaves exactly like a login code; the recipient reads it from their
 * phone) — the response reports delivery status, the provider, latency and
 * the effective TTL.
 *
 * Guards:
 *  - An ACTIVE, configured provider is required (test-mode display is not
 *    involved here — this is a real-delivery test).
 *  - Rate limits: 5 sends / 10 min per superadmin session + the target
 *    phone's OTP engine limits are NOT bypassed.
 *  - Audit-logged (OTP_TEST_SEND) — phone only, never the code.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;
  const actor = auth.user;

  const rl = rateLimit(`otp-send-test:${actor.id}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "تعداد ارسال‌های آزمایشی بیش از حد مجاز است. کمی بعد تلاش کنید." },
      { status: 429 },
    );
  }

  // Target phone: explicit body value, else the superadmin's registered phone.
  let phoneRaw = "";
  try {
    const body = (await req.json()) as { phone?: unknown };
    phoneRaw = typeof body?.phone === "string" ? body.phone.trim() : "";
  } catch {
    return NextResponse.json({ error: "بدنه JSON نامعتبر است" }, { status: 400 });
  }
  if (!phoneRaw) {
    const primary = await getPrimarySuperadmin();
    phoneRaw = primary?.phone ?? "";
  }
  const phone = normalizePhone(phoneRaw);
  if (!phoneRaw || !isValidIranPhone(phone)) {
    return NextResponse.json(
      { error: "شماره موبایل نامعتبر است. مثال: 09123456789" },
      { status: 400 },
    );
  }

  // A real, active provider is mandatory for the test send.
  const { adapter, reason, providerId } = await getActiveProvider();
  if (!adapter) {
    const error =
      reason === "disabled"
        ? "سرویس پیامک فعال‌شده، غیرفعال است. ابتدا وضعیت آن را در همین صفحه بررسی کنید."
        : reason === "not_configured"
          ? "اطلاعات اتصال سرویس فعال کامل نیست — ابتدا فیلدهای الزامی را ذخیره و «تست اتصال» را انجام دهید."
          : "هیچ سرویس پیامکی فعال نیست. ابتدا یک سرویس را فعال و تنظیم کنید.";
    return NextResponse.json({ error }, { status: 400 });
  }

  const outcome = await deliverOtp({ phone, purpose: "otp-test" });

  await audit({
    actor: {
      id: actor.id,
      username: actor.username ?? "",
      role: actor.role,
      schoolId: actor.schoolId ?? null,
    },
    action: AuditActions.OTP_TEST_SEND,
    targetType: "phone",
    targetId: phone,
    req,
    meta: {
      ok: outcome.sent,
      providerId: outcome.providerId,
      managed: outcome.managed,
      errorCode: outcome.errorCode ?? null,
    },
  });

  if (!outcome.sent) {
    return NextResponse.json(
      {
        ok: false,
        provider: providerId,
        errorCode: outcome.errorCode ?? "send_failed",
        errorMessage:
          outcome.errorMessage ?? "ارسال پیامک ناموفق بود. لطفاً تنظیمات سرویس و موجودی پنل را بررسی کنید.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    provider: providerId,
    managed: outcome.managed,
    ttlSeconds: outcome.ttlSeconds,
    messageId: outcome.messageId ?? null,
    detail: outcome.detail ?? null,
  });
}
