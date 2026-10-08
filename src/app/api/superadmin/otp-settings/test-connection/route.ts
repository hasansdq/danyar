import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import { getProviderDef } from "@/lib/sms/provider-registry";
import { getProviderById, buildAdapter } from "@/lib/sms/provider-config";
import { logDelivery } from "@/lib/sms/delivery-log";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/superadmin/otp-settings/test-connection
 * Body: { provider: "<id>" }
 *
 * Runs the provider's lightweight connectivity/credential check (credit or
 * usage lookup — NEVER sends an SMS). Works for any provider — enabled or
 * not, active or not — so credentials can be verified BEFORE activating.
 * The result is logged to SmsDeliveryLog (purpose "test-connection") and
 * audit-logged.
 *
 * Rate limit: 10 calls / 5 min per superadmin session (outbound API abuse guard).
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;
  const actor = auth.user;

  const rl = rateLimit(`otp-test-conn:${actor.id}`, { limit: 10, windowMs: 5 * 60 * 1000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "تعداد درخواست‌های تست اتصال بیش از حد مجاز است. کمی بعد تلاش کنید." },
      { status: 429 },
    );
  }

  let provider = "";
  try {
    const body = (await req.json()) as { provider?: unknown };
    provider = typeof body?.provider === "string" ? body.provider : "";
  } catch {
    return NextResponse.json({ error: "بدنه JSON نامعتبر است" }, { status: 400 });
  }

  const def = getProviderDef(provider);
  if (!def) {
    return NextResponse.json({ error: "شناسه سرویس نامعتبر است" }, { status: 400 });
  }

  const resolved = await getProviderById(provider);
  if (!resolved) {
    return NextResponse.json({ error: "شناسه سرویس نامعتبر است" }, { status: 400 });
  }

  const missing = resolved.def.fields
    .filter((f) => f.required)
    .filter((f) => !resolved.fields.find((x) => x.def.key === f.key)?.value)
    .map((f) => f.label);
  if (missing.length) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: "not_configured",
        errorMessage: `ابتدا اطلاعات اتصال را ذخیره کنید — فیلدهای الزامی تنظیم نشده‌اند: ${missing.join("، ")}`,
      },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  const adapter = buildAdapter(resolved);
  const result = await adapter.testConnection();
  const latencyMs = Date.now() - startedAt;

  await logDelivery({
    provider: def.id,
    phone: "connection-test", // masked as-is — no real recipient
    purpose: "test-connection",
    ok: result.ok,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    latencyMs,
  });

  await audit({
    actor: {
      id: actor.id,
      username: actor.username ?? "",
      role: actor.role,
      schoolId: actor.schoolId ?? null,
    },
    action: AuditActions.OTP_SETTINGS_UPDATE,
    targetType: "settings",
    targetId: `otp-provider:${def.id}`,
    req,
    meta: {
      operation: "test-connection",
      ok: result.ok,
      errorCode: result.errorCode ?? null,
      latencyMs,
    },
  });

  return NextResponse.json({
    ok: result.ok,
    provider: def.id,
    detail: result.detail ?? null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    latencyMs,
  });
}
