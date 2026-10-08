/**
 * OTP settings + provider configuration resolution (Phase 37).
 *
 * Where each setting lives:
 *  - «مدیریت ورود کاربر» (login-settings.ts) still owns WHICH login methods
 *    exist (password / SMS / test-code display). Unchanged.
 *  - THIS module owns the OTP engine + provider settings of the new
 *    «مدیریت OTP» superadmin section:
 *      otp_ttl_seconds           — code validity (default 120s)
 *      otp_rate_phone_per_hour   — per-PHONE request cap (real mode)
 *      otp_rate_ip_per_hour      — per-IP request cap
 *      otp_rate_device_per_hour  — per-DEVICE request cap (opaque cookie id)
 *      otp_active_provider       — "off" | provider id
 *      otp_provider_<id>_enabled — per-provider enable toggle
 *      otp_cred_<provider>_<field> — per-provider credentials
 *
 * CREDENTIAL RESOLUTION ORDER (per field): DB SiteSetting value → matching
 * environment variable → unset. Secrets are WRITE-ONLY through the API —
 * they are never returned to the frontend (only an isSet + source badge).
 */

import { db } from "@/lib/db";
import {
  PROVIDER_DEFS,
  getProviderDef,
  providerEnabledKey,
  providerCredentialKey,
  type ProviderDef,
  type ProviderFieldDef,
} from "./provider-registry";
import type { SMSProviderAdapter, SMSProviderId, SMSProviderConfig } from "./providers/types";

// ---------------------------------------------------------------------------
// Setting keys + defaults
// ---------------------------------------------------------------------------

export const OTP_SETTING_KEYS = {
  ttlSeconds: "otp_ttl_seconds",
  ratePhonePerHour: "otp_rate_phone_per_hour",
  rateIpPerHour: "otp_rate_ip_per_hour",
  rateDevicePerHour: "otp_rate_device_per_hour",
  activeProvider: "otp_active_provider",
} as const;

export const OTP_DEFAULTS = {
  /** Code validity — the owner-specified default is 120 seconds. */
  ttlSeconds: 120,
  ratePhonePerHour: 3,
  rateIpPerHour: 10,
  rateDevicePerHour: 10,
  activeProvider: "off" as string,
} as const;

export const OTP_LIMITS = {
  ttlSeconds: { min: 30, max: 900 },
  ratePhonePerHour: { min: 1, max: 60 },
  rateIpPerHour: { min: 1, max: 240 },
  rateDevicePerHour: { min: 1, max: 240 },
} as const;

export interface OtpEngineSettings {
  ttlSeconds: number;
  ratePhonePerHour: number;
  rateIpPerHour: number;
  rateDevicePerHour: number;
}

/** Read an integer SiteSetting with bounds + default fallback. */
async function readIntSetting(
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): Promise<number> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key }, select: { value: true } });
    if (!row) return fallback;
    const n = Number.parseInt(row.value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(bounds.max, Math.max(bounds.min, n));
  } catch {
    return fallback;
  }
}

/** Load the OTP engine settings (bounds-clamped, fail-open to defaults). */
export async function getOtpEngineSettings(): Promise<OtpEngineSettings> {
  const [ttl, phone, ip, device] = await Promise.all([
    readIntSetting(OTP_SETTING_KEYS.ttlSeconds, OTP_DEFAULTS.ttlSeconds, OTP_LIMITS.ttlSeconds),
    readIntSetting(OTP_SETTING_KEYS.ratePhonePerHour, OTP_DEFAULTS.ratePhonePerHour, OTP_LIMITS.ratePhonePerHour),
    readIntSetting(OTP_SETTING_KEYS.rateIpPerHour, OTP_DEFAULTS.rateIpPerHour, OTP_LIMITS.rateIpPerHour),
    readIntSetting(OTP_SETTING_KEYS.rateDevicePerHour, OTP_DEFAULTS.rateDevicePerHour, OTP_LIMITS.rateDevicePerHour),
  ]);
  return { ttlSeconds: ttl, ratePhonePerHour: phone, rateIpPerHour: ip, rateDevicePerHour: device };
}

/** Read a boolean SiteSetting (fail-open default). */
export async function readProviderEnabled(id: SMSProviderId, fallback = false): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({
      where: { key: providerEnabledKey(id) },
      select: { value: true },
    });
    if (!row) return fallback;
    return row.value === "true";
  } catch {
    return fallback;
  }
}

/** The currently selected active provider id ("off" when none/invalid). */
export async function getActiveProviderId(): Promise<string> {
  try {
    const row = await db.siteSetting.findUnique({
      where: { key: OTP_SETTING_KEYS.activeProvider },
      select: { value: true },
    });
    const value = row?.value ?? OTP_DEFAULTS.activeProvider;
    return value === "off" || getProviderDef(value) ? value : "off";
  } catch {
    return "off";
  }
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

export interface ResolvedField {
  def: ProviderFieldDef;
  /** Resolved value ("" when unset). Secrets NEVER leave the server. */
  value: string;
  /** Where the value came from. */
  source: "db" | "env" | "unset";
}

export interface ResolvedProvider {
  def: ProviderDef;
  enabled: boolean;
  fields: ResolvedField[];
  /** All REQUIRED fields resolved non-empty? */
  configured: boolean;
}

/** Resolve one provider's fields from DB → env. */
export async function resolveProvider(def: ProviderDef): Promise<ResolvedProvider> {
  const keys = def.fields.map((f) => providerCredentialKey(def.id, f.key));
  const rows = await db.siteSetting
    .findMany({ where: { key: { in: keys } }, select: { key: true, value: true } })
    .catch(() => [] as Array<{ key: string; value: string }>);
  const dbMap = new Map<string, string>(rows.map((r) => [r.key, r.value]));
  const enabled = await readProviderEnabled(def.id);

  const fields: ResolvedField[] = def.fields.map((f) => {
    const dbValue = (dbMap.get(providerCredentialKey(def.id, f.key)) ?? "").trim();
    const envValue = (process.env[f.envVar] ?? "").trim();
    if (dbValue) return { def: f, value: dbValue, source: "db" as const };
    if (envValue) return { def: f, value: envValue, source: "env" as const };
    return { def: f, value: "", source: "unset" as const };
  });

  return {
    def,
    enabled,
    fields,
    configured: def.fields.filter((f) => f.required).every((f) => fields.find((x) => x.def.key === f.key)?.value),
  };
}

/** Resolve every provider (for the settings API + panel). */
export async function resolveAllProviders(): Promise<ResolvedProvider[]> {
  return Promise.all(PROVIDER_DEFS.map((def) => resolveProvider(def)));
}

/** Split resolved fields into the adapter config shape (fields/secrets). */
function toAdapterConfig(resolved: ResolvedProvider): SMSProviderConfig {
  const fields: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of resolved.fields) {
    if (!f.value) continue;
    if (f.def.secret) secrets[f.def.key] = f.value;
    else fields[f.def.key] = f.value;
  }
  return { fields, secrets };
}

/**
 * Build the ACTIVE provider adapter (or null).
 * Returns null when: active = "off", the provider is disabled, or required
 * credentials are missing. Also returns the failure reason for diagnostics.
 */
export async function getActiveProvider(): Promise<{
  adapter: SMSProviderAdapter | null;
  reason?: "off" | "disabled" | "not_configured" | "unknown";
  providerId: string;
}> {
  const activeId = await getActiveProviderId();
  if (activeId === "off") return { adapter: null, reason: "off", providerId: "off" };
  const def = getProviderDef(activeId);
  if (!def) return { adapter: null, reason: "unknown", providerId: activeId };
  const resolved = await resolveProvider(def);
  if (!resolved.enabled) return { adapter: null, reason: "disabled", providerId: activeId };
  if (!resolved.configured) return { adapter: null, reason: "not_configured", providerId: activeId };
  return { adapter: def.create(toAdapterConfig(resolved)), providerId: activeId };
}

/**
 * Build an adapter for an ARBITRARY provider (panel «تست اتصال» — works for
 * non-active providers too so credentials can be verified before switching).
 * Required fields must be resolvable, else null.
 */
export async function getProviderById(id: string): Promise<ResolvedProvider | null> {
  const def = getProviderDef(id);
  if (!def) return null;
  return resolveProvider(def);
}

/** Adapter factory from an already-resolved provider (for tests). */
export function buildAdapter(resolved: ResolvedProvider): SMSProviderAdapter {
  return resolved.def.create(toAdapterConfig(resolved));
}
