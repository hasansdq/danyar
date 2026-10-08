/**
 * Server-side login-management settings — the "مدیریت ورود کاربر" module.
 *
 * Controls WHICH login methods are available platform-wide:
 *  - `login_password_enabled`      → username + password login (default ON)
 *  - `login_sms_enabled`           → SMS OTP login (default ON)
 *  - `login_sms_show_test_code`    → TEST MODE: when ON, the OTP request
 *                                    response includes the generated code so
 *                                    the login page can DISPLAY it (default
 *                                    ON — lets members log in without a real
 *                                    SMS gateway). The superadmin should turn
 *                                    this OFF once a real SMS provider is
 *                                    configured in production.
 *  - superadmin SMS phone          → stored on the PRIMARY SUPERADMIN user
 *                                    row (User.phone), default 0913652461.
 *
 * These keys are intentionally NOT part of the public site-settings catalog
 * (site-settings.ts) — they are managed exclusively through
 * /api/superadmin/login-settings so there is a single control surface.
 *
 * Fail-open policy: if the settings read fails (DB error), the defaults
 * (everything enabled) apply so logins never break because of a read error.
 */

import { db } from "@/lib/db";
import { normalizePhone, isValidIranPhone } from "@/lib/sms/otp";

/** SiteSetting keys owned by this module. */
export const LOGIN_SETTING_KEYS = {
  passwordEnabled: "login_password_enabled",
  smsEnabled: "login_sms_enabled",
  showTestCode: "login_sms_show_test_code",
} as const;

/**
 * Default phone used for the superadmin's SMS login when the SUPERADMIN user
 * row has no phone set (per the owner's specification).
 */
export const DEFAULT_SUPERADMIN_SMS_PHONE = "0913652461";

export interface LoginSettings {
  /** Username + password login allowed? */
  passwordEnabled: boolean;
  /** SMS OTP login allowed? */
  smsEnabled: boolean;
  /** TEST MODE — OTP code returned in the request response + shown on the login page? */
  showTestCode: boolean;
  /** Effective SMS login phone of the primary SUPERADMIN (row value or default). */
  superadminPhone: string;
}

/** Read a boolean SiteSetting with a safe fallback. */
async function readBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    if (!row) return fallback;
    return row.value === "true";
  } catch {
    return fallback;
  }
}

/** Upsert a boolean SiteSetting row. */
export async function writeBoolSetting(key: string, value: boolean): Promise<void> {
  await db.siteSetting.upsert({
    where: { key },
    update: { value: value ? "true" : "false" },
    create: { key, value: value ? "true" : "false" },
  });
}

/**
 * The PRIMARY superadmin (first created SUPERADMIN account). Deterministic
 * so GET and PATCH always talk about the same account.
 */
export async function getPrimarySuperadmin() {
  return db.user.findFirst({
    where: { role: "SUPERADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, phone: true, fullName: true },
  });
}

/** Load the full login-management settings snapshot. */
export async function getLoginSettings(): Promise<LoginSettings> {
  const [passwordEnabled, smsEnabled, showTestCode, superadmin] = await Promise.all([
    readBoolSetting(LOGIN_SETTING_KEYS.passwordEnabled, true),
    readBoolSetting(LOGIN_SETTING_KEYS.smsEnabled, true),
    readBoolSetting(LOGIN_SETTING_KEYS.showTestCode, true),
    getPrimarySuperadmin().catch(() => null),
  ]);
  return {
    passwordEnabled,
    smsEnabled,
    showTestCode,
    superadminPhone: superadmin?.phone?.trim() || DEFAULT_SUPERADMIN_SMS_PHONE,
  };
}

/** Is username+password login currently allowed? (fail-open) */
export async function isPasswordLoginEnabled(): Promise<boolean> {
  return readBoolSetting(LOGIN_SETTING_KEYS.passwordEnabled, true);
}

/** Is SMS OTP login currently allowed? (fail-open; provider NOT required — test mode works without one) */
export async function isSMSLoginEnabled(): Promise<boolean> {
  return readBoolSetting(LOGIN_SETTING_KEYS.smsEnabled, true);
}

/** Is TEST MODE active (the OTP code is returned to + displayed on the login page)? (fail-open) */
export async function isTestCodeDisplayEnabled(): Promise<boolean> {
  return readBoolSetting(LOGIN_SETTING_KEYS.showTestCode, true);
}

/**
 * Validate + normalize a superadmin SMS phone. Returns a Persian error for
 * invalid formats. Accepts 10-digit (09xxxxxxxx) numbers such as the
 * owner-specified default 0913652461 as well as standard 11-digit ones.
 */
export function validateSuperadminPhone(raw: string): { phone: string } | { error: string } {
  const phone = normalizePhone((raw ?? "").trim());
  if (!isValidIranPhone(phone)) {
    return {
      error: "شماره موبایل نامعتبر است. مثال صحیح: 0913652461 یا 09123456789",
    };
  }
  return { phone };
}
