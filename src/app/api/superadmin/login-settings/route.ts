import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import {
  getLoginSettings,
  getPrimarySuperadmin,
  writeBoolSetting,
  validateSuperadminPhone,
  LOGIN_SETTING_KEYS,
  type LoginSettings,
} from "@/lib/login-settings";

export const dynamic = "force-dynamic";

/**
 * /api/superadmin/login-settings — the «مدیریت ورود کاربر» backend.
 *
 * GET   → { data: { passwordEnabled, smsEnabled, showTestCode, superadminPhone } }
 *
 * PATCH → partial update:
 *   {
 *     passwordEnabled?:  boolean,  // login_password_enabled
 *     smsEnabled?:       boolean,  // login_sms_enabled
 *     showTestCode?:     boolean,  // login_sms_show_test_code (TEST MODE)
 *     superadminPhone?:  string    // written onto the PRIMARY SUPERADMIN user row
 *   }
 *
 * Guards:
 *  - SUPERADMIN session required (requireSuperAdminApi).
 *  - Disabling BOTH login methods at once is rejected (total lockout guard).
 *  - The superadmin phone is normalized + format-checked and may not be
 *    assigned to any non-SUPERADMIN account (OTP ambiguity/hijack guard).
 *  - Every change is audit-logged (LOGIN_SETTINGS_UPDATE).
 */

async function fetchSettings(): Promise<LoginSettings> {
  return getLoginSettings();
}

export async function GET() {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const data = await fetchSettings();
  return NextResponse.json({ data });
}

interface PatchBody {
  passwordEnabled?: unknown;
  smsEnabled?: unknown;
  showTestCode?: unknown;
  superadminPhone?: unknown;
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;
  const actor = auth.user;

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "بدنه JSON نامعتبر است" }, { status: 400 });
  }

  // Snapshot BEFORE applying anything — used by the total-lockout guard
  // below to roll back if the patch would disable every login method.
  const before = await fetchSettings();

  const changed: string[] = [];

  // ---- Boolean toggles -------------------------------------------------
  const toggles: Array<{
    field: "passwordEnabled" | "smsEnabled" | "showTestCode";
    key: string;
    label: string;
  }> = [
    { field: "passwordEnabled", key: LOGIN_SETTING_KEYS.passwordEnabled, label: "ورود با رمز عبور" },
    { field: "smsEnabled", key: LOGIN_SETTING_KEYS.smsEnabled, label: "ورود پیامکی" },
    { field: "showTestCode", key: LOGIN_SETTING_KEYS.showTestCode, label: "نمایش کد ورود تستی" },
  ];

  for (const t of toggles) {
    const value = (body as Record<string, unknown>)[t.field];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return NextResponse.json(
        { error: `مقدار «${t.label}» باید بولی (true/false) باشد` },
        { status: 400 },
      );
    }
    await writeBoolSetting(t.key, value);
    changed.push(`${t.label}=${value ? "فعال" : "غیرفعال"}`);
  }

  // ---- Superadmin SMS phone --------------------------------------------
  if (body.superadminPhone !== undefined) {
    const raw = body.superadminPhone;
    if (typeof raw !== "string") {
      return NextResponse.json(
        { error: "شماره موبایل باید رشته‌ای باشد" },
        { status: 400 },
      );
    }
    const validated = validateSuperadminPhone(raw);
    if ("error" in validated) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const phone = validated.phone;

    // The phone must not belong to any NON-superadmin account — otherwise
    // OTP login for that phone would either become ambiguous or let a
    // member's phone sign in as the superadmin on /superadmin/login.
    const conflicting = await db.user.findFirst({
      where: { phone, NOT: { role: "SUPERADMIN" } },
      select: { id: true, username: true },
    });
    if (conflicting) {
      return NextResponse.json(
        {
          error: `این شماره موبایل به حساب «${conflicting.username}» اختصاص دارد و نمی‌تواند شماره مدیر کل باشد.`,
        },
        { status: 409 },
      );
    }

    const target = await getPrimarySuperadmin();
    if (!target) {
      return NextResponse.json(
        { error: "حساب مدیر کل در سیستم یافت نشد." },
        { status: 404 },
      );
    }
    await db.user.update({
      where: { id: target.id },
      data: { phone },
    });
    changed.push(`شماره پیامکی مدیر کل=${phone}`);
  }

  // ---- Total-lockout guard ----------------------------------------------
  // Reject a combination that would leave NO login method available
  // (password + SMS both off = nobody, including the superadmin, could
  // ever sign in again). Rolls the toggles back to the pre-patch snapshot.
  const effective = await fetchSettings();
  if (!effective.passwordEnabled && !effective.smsEnabled) {
    await writeBoolSetting(LOGIN_SETTING_KEYS.passwordEnabled, before.passwordEnabled);
    await writeBoolSetting(LOGIN_SETTING_KEYS.smsEnabled, before.smsEnabled);
    return NextResponse.json(
      {
        error:
          "غیرفعال‌سازی همزمان «ورود با رمز» و «ورود پیامکی» مجاز نیست — حداقل یکی از روش‌های ورود باید فعال بماند.",
      },
      { status: 400 },
    );
  }

  // ---- Audit -------------------------------------------------------------
  if (changed.length > 0) {
    await audit({
      actor: {
        id: actor.id,
        username: actor.username ?? "",
        role: actor.role,
        schoolId: actor.schoolId ?? null,
      },
      action: AuditActions.LOGIN_SETTINGS_UPDATE,
      targetType: "settings",
      targetId: "login-management",
      req,
      meta: { changed },
    });
  }

  const data = await fetchSettings();
  return NextResponse.json({ data });
}
