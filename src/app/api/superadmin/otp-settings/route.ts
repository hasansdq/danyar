import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import {
  PROVIDER_DEFS,
  providerEnabledKey,
  providerCredentialKey,
  getProviderDef,
  type ProviderFieldDef,
} from "@/lib/sms/provider-registry";
import {
  resolveAllProviders,
  resolveProvider,
  getActiveProviderId,
  getOtpEngineSettings,
  readProviderEnabled,
  OTP_SETTING_KEYS,
  OTP_LIMITS,
  type ResolvedProvider,
} from "@/lib/sms/provider-config";
import { getDeliveryStatus, getRecentDeliveryLogs } from "@/lib/sms/delivery-log";
import { isTestCodeDisplayEnabled, getPrimarySuperadmin } from "@/lib/login-settings";

export const dynamic = "force-dynamic";

/**
 * /api/superadmin/otp-settings — the «مدیریت OTP» backend (Phase 37).
 *
 * GET → the full settings + status snapshot:
 *   {
 *     activeProvider, testCodeDisplay,
 *     engine: { ttlSeconds, ratePhonePerHour, rateIpPerHour, rateDevicePerHour },
 *     providers: [{
 *       id, label, description, docsUrl, enabled, configured, managed, plainSms,
 *       fields: [{ key, label, description, secret, required, envVar,
 *                  isSet, source: "db"|"env"|"unset", value?  (NON-SECRET ONLY) }]
 *     }],
 *     status: { lastSendAt, lastError, recentLogs }
 *   }
 *
 *   SECURITY: secret field values (API keys / passwords / usernames) are
 *   NEVER included — only isSet + where they come from. Non-secret fields
 *   (line numbers, pattern ids, parameter names) are returned in clear.
 *
 * PATCH → partial update:
 *   {
 *     activeProvider?: "off" | providerId,      // must be enabled + configured
 *     ttlSeconds?: number,                       // 30..900
 *     rateLimits?: { phonePerHour?, ipPerHour?, devicePerHour? },
 *     providerEnabled?: { id, enabled },
 *     credentials?: { provider, values: { <fieldKey>: string } }  // secrets WRITE-ONLY
 *   }
 *
 *   Credential semantics: only fields PRESENT in `values` are written. A
 *   non-empty string upserts the DB row; the sentinel "__clear__" deletes
 *   the DB row (falls back to the env var when one exists). Secret values
 *   are never echoed back.
 *
 *   Every change is audit-logged (OTP_SETTINGS_UPDATE) with credential
 *   values redacted by the audit layer.
 */

async function buildSnapshot() {
  const [activeProvider, engine, providers, status, recentLogs, testCodeDisplay, primary] = await Promise.all([
    getActiveProviderId(),
    getOtpEngineSettings(),
    resolveAllProviders(),
    getDeliveryStatus(),
    getRecentDeliveryLogs(20),
    isTestCodeDisplayEnabled(),
    getPrimarySuperadmin().catch(() => null),
  ]);

  return {
    activeProvider,
    testCodeDisplay,
    engine,
    superadminPhone: primary?.phone ?? "",
    providers: providers.map(serializeProvider),
    status: { ...status, recentLogs },
  };
}

/** Public (panel) representation of a resolved provider — secrets stripped. */
function serializeProvider(p: ResolvedProvider) {
  return {
    id: p.def.id,
    label: p.def.label,
    description: p.def.description,
    docsUrl: p.def.docsUrl,
    managed: p.def.managed,
    plainSms: p.def.plainSms,
    enabled: p.enabled,
    configured: p.configured,
    fields: p.def.fields.map((f) => {
      const resolved = p.fields.find((x) => x.def.key === f.key);
      return {
        key: f.key,
        label: f.label,
        description: f.description ?? null,
        secret: f.secret,
        required: f.required,
        envVar: f.envVar,
        placeholder: f.placeholder ?? null,
        isSet: Boolean(resolved?.value),
        source: resolved?.source ?? "unset",
        // NON-SECRET values only — API keys/passwords are never returned.
        value: f.secret ? undefined : (resolved?.value ?? ""),
      };
    }),
  };
}

export async function GET() {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const data = await buildSnapshot();
  return NextResponse.json({ data });
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

interface PatchBody {
  activeProvider?: unknown;
  ttlSeconds?: unknown;
  rateLimits?: {
    phonePerHour?: unknown;
    ipPerHour?: unknown;
    devicePerHour?: unknown;
  };
  providerEnabled?: { id?: unknown; enabled?: unknown };
  credentials?: { provider?: unknown; values?: unknown };
}

/** Upsert a SiteSetting string row. */
async function writeSetting(key: string, value: string): Promise<void> {
  await db.siteSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function deleteSetting(key: string): Promise<void> {
  await db.siteSetting.deleteMany({ where: { key } });
}

/** Validate + clamp an integer with a Persian error. */
function intOrError(value: unknown, label: string, bounds: { min: number; max: number }): { n: number } | { error: string } {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return { error: `مقدار «${label}» باید عددی باشد` };
  if (n < bounds.min || n > bounds.max) {
    return { error: `مقدار «${label}» باید بین ${bounds.min} و ${bounds.max} باشد` };
  }
  return { n: Math.round(n) };
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

  const changed: string[] = [];

  // ---- Engine settings (TTL + rate limits) ------------------------------
  if (body.ttlSeconds !== undefined) {
    const result = intOrError(body.ttlSeconds, "مدت اعتبار کد", OTP_LIMITS.ttlSeconds);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    await writeSetting(OTP_SETTING_KEYS.ttlSeconds, String(result.n));
    changed.push(`مدت اعتبار=${result.n} ثانیه`);
  }

  if (body.rateLimits && typeof body.rateLimits === "object") {
    type RateLimitField = "phonePerHour" | "ipPerHour" | "devicePerHour";
    const entries: Array<{ field: RateLimitField; key: string; label: string; bounds: { min: number; max: number } }> = [
      { field: "phonePerHour", key: OTP_SETTING_KEYS.ratePhonePerHour, label: "سقف درخواست هر شماره", bounds: OTP_LIMITS.ratePhonePerHour },
      { field: "ipPerHour", key: OTP_SETTING_KEYS.rateIpPerHour, label: "سقف درخواست هر IP", bounds: OTP_LIMITS.rateIpPerHour },
      { field: "devicePerHour", key: OTP_SETTING_KEYS.rateDevicePerHour, label: "سقف درخواست هر دستگاه", bounds: OTP_LIMITS.rateDevicePerHour },
    ];
    for (const e of entries) {
      const value = body.rateLimits![e.field];
      if (value === undefined) continue;
      const result = intOrError(value, e.label, e.bounds);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
      await writeSetting(e.key, String(result.n));
      changed.push(`${e.label}=${result.n}/ساعت`);
    }
  }

  // ---- Per-provider enable toggle ---------------------------------------
  if (body.providerEnabled !== undefined) {
    const { id, enabled } = body.providerEnabled ?? {};
    if (typeof id !== "string" || !getProviderDef(id)) {
      return NextResponse.json({ error: "شناسه سرویس نامعتبر است" }, { status: 400 });
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "مقدار «فعال بودن سرویس» باید بولی باشد" }, { status: 400 });
    }
    await writeSetting(providerEnabledKey(id as Parameters<typeof providerEnabledKey>[0]), enabled ? "true" : "false");

    // Guard: disabling the CURRENTLY ACTIVE provider also deactivates it,
    // so the panel never shows an active-but-disabled provider.
    const activeId = await getActiveProviderId();
    if (!enabled && activeId === id) {
      await writeSetting(OTP_SETTING_KEYS.activeProvider, "off");
      changed.push(`سرویس فعال به «خاموش» تغییر یافت (غیرفعال‌سازی ${getProviderDef(id)!.label})`);
    }
    changed.push(`${getProviderDef(id)!.label} ${enabled ? "فعال" : "غیرفعال"}`);
  }

  // ---- Credentials (secrets WRITE-ONLY) ----------------------------------
  if (body.credentials !== undefined) {
    const { provider, values } = body.credentials ?? {};
    if (typeof provider !== "string" || !getProviderDef(provider)) {
      return NextResponse.json({ error: "شناسه سرویس نامعتبر است" }, { status: 400 });
    }
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      return NextResponse.json({ error: "مقادیر اعتبارنامه‌ها باید شیء JSON باشد" }, { status: 400 });
    }
    const def = getProviderDef(provider)!;
    const fieldDefs = new Map<string, ProviderFieldDef>(def.fields.map((f) => [f.key, f]));
    const written: string[] = [];

    for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
      const field = fieldDefs.get(key);
      if (!field) {
        return NextResponse.json(
          { error: `فیلد «${key}» برای سرویس ${def.label} وجود ندارد` },
          { status: 400 },
        );
      }
      if (typeof raw !== "string") {
        return NextResponse.json(
          { error: `مقدار فیلد «${field.label}» باید رشته‌ای باشد` },
          { status: 400 },
        );
      }
      const settingKey = providerCredentialKey(def.id, field.key);
      if (raw === "__clear__") {
        await deleteSetting(settingKey);
        written.push(`${field.label}=پاک شد`);
      } else {
        const trimmed = raw.trim();
        if (!trimmed) {
          await deleteSetting(settingKey);
          written.push(`${field.label}=پاک شد`);
        } else {
          if (trimmed.length > 500) {
            return NextResponse.json(
              { error: `مقدار فیلد «${field.label}» بیش از حد طولانی است` },
              { status: 400 },
            );
          }
          await writeSetting(settingKey, trimmed);
          written.push(`${field.label}=ذخیره شد`);
        }
      }
    }
    if (written.length) changed.push(`اعتبارنامه‌های ${def.label}: ${written.join("، ")}`);

    // Guard: after credential changes the ACTIVE provider may have become
    // unconfigured — deactivate it in that case (fail-safe, never broken).
    const activeId = await getActiveProviderId();
    if (activeId !== "off" && activeId === def.id) {
      const resolved = await resolveProvider(def);
      if (!resolved.configured) {
        await writeSetting(OTP_SETTING_KEYS.activeProvider, "off");
        changed.push("سرویس فعال به دلیل نقص اعتبارنامه‌ها غیرفعال شد");
      }
    }
  }

  // ---- Active provider selection -----------------------------------------
  if (body.activeProvider !== undefined) {
    const value = body.activeProvider;
    if (typeof value !== "string" || (value !== "off" && !getProviderDef(value))) {
      return NextResponse.json(
        { error: `سرویس نامعتبر است. مقدارهای مجاز: off، ${PROVIDER_DEFS.map((p) => p.id).join("، ")}` },
        { status: 400 },
      );
    }
    if (value !== "off") {
      const def = getProviderDef(value)!;
      const resolved = await resolveProvider(def);
      if (!resolved.configured) {
        return NextResponse.json(
          {
            error: `اطلاعات اتصال سرویس ${def.label} کامل نیست — ابتدا همه فیلدهای الزامی را ذخیره کنید.`,
          },
          { status: 400 },
        );
      }
      const enabled = await readProviderEnabled(def.id);
      if (!enabled) {
        return NextResponse.json(
          { error: `سرویس ${def.label} غیرفعال است — ابتدا آن را فعال کنید.` },
          { status: 400 },
        );
      }
    }
    await writeSetting(OTP_SETTING_KEYS.activeProvider, value);
    changed.push(value === "off" ? "سرویس فعال: هیچ" : `سرویس فعال: ${getProviderDef(value)!.label}`);
  }

  // ---- Audit ---------------------------------------------------------------
  if (changed.length > 0) {
    await audit({
      actor: {
        id: actor.id,
        username: actor.username ?? "",
        role: actor.role,
        schoolId: actor.schoolId ?? null,
      },
      action: AuditActions.OTP_SETTINGS_UPDATE,
      targetType: "settings",
      targetId: "otp-management",
      req,
      meta: { changed },
    });
  }

  const data = await buildSnapshot();
  return NextResponse.json({ data });
}
