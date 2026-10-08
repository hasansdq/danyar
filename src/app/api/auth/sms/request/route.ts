import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isSMSLoginEnabled, isTestCodeDisplayEnabled } from "@/lib/login-settings";
import { getOtpEngineSettings } from "@/lib/sms/provider-config";
import { deliverOtp } from "@/lib/sms/send";
import { normalizePhone, isValidIranPhone, hasActiveOTP, getActiveOTPCode } from "@/lib/sms/otp";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { audit, AuditActions } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sms/request
 * Body: { phone: string }
 *
 * Issues an OTP for the phone number using the provider-based engine
 * (Phase 37): the code is stored HASHED (HMAC-SHA-256) in the OtpCode table
 * and delivered through the ACTIVE provider configured in «مدیریت OTP».
 *
 * Behaviour is controlled by the superadmin's settings:
 *
 *  - `login_sms_enabled` OFF («مدیریت ورود کاربر») → 403.
 *  - TEST MODE (`login_sms_show_test_code` ON — the default):
 *      the OTP is issued for ANY well-formed phone and the response
 *      includes `testMode: true` + `testCode` so the login page DISPLAYS the
 *      code. Real delivery through the provider is best-effort. A code still
 *      ACTIVE? The SAME code is re-displayed (`reused: true`).
 *  - REAL MODE: the classic enumeration-safe flow — codes are only sent for
 *      phones that exist in the DB (200 + `sent:false` otherwise), a
 *      configured provider is REQUIRED, provider failures return a Persian
 *      502 error, and an active OTP blocks re-issuance (429).
 *
 * RATE LIMITS — configurable in «مدیریت OTP» (defaults: 3/phone/h,
 * 10/IP/h, 10/device/h). TEST mode floors them at relaxed values
 * (30/phone, 60/IP, 120/device) because retries re-display the same code.
 * The device key is an opaque HttpOnly cookie (`otp_did`) minted below.
 *
 * SECURITY: the code is never logged; audit entries carry the phone only.
 */

/** Opaque device id cookie — 32 hex chars, 1 year, HttpOnly + SameSite=Lax. */
const DEVICE_COOKIE = "otp_did";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function readOrCreateDeviceId(req: NextRequest): { deviceId: string; setCookie?: string } {
  const existing = req.cookies.get(DEVICE_COOKIE)?.value;
  if (existing && /^[0-9a-f]{32}$/.test(existing)) return { deviceId: existing };
  // Mint a fresh id (crypto random — not derived from anything identifying).
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const deviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  const setCookie = `${DEVICE_COOKIE}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_COOKIE_MAX_AGE};${secure}`;
  return { deviceId, setCookie };
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phoneRaw = body?.phone?.toString()?.trim() ?? "";
  const phone = normalizePhone(phoneRaw);

  if (!isValidIranPhone(phone)) {
    return NextResponse.json(
      { error: "شماره موبایل نامعتبر است" },
      { status: 400 },
    );
  }

  // «مدیریت ورود کاربر» — SMS login master toggle.
  const smsEnabled = await isSMSLoginEnabled();
  if (!smsEnabled) {
    return NextResponse.json(
      { error: "ورود پیامکی فعال نیست. لطفاً با نام کاربری و رمز عبور وارد شوید." },
      { status: 403 },
    );
  }

  const showTestCode = await isTestCodeDisplayEnabled();
  const { deviceId, setCookie } = readOrCreateDeviceId(req);

  // ── Rate limits (configurable in «مدیریت OTP»; test mode floors) ──────
  const engine = await getOtpEngineSettings();
  const phoneLimit = showTestCode ? Math.max(engine.ratePhonePerHour, 30) : engine.ratePhonePerHour;
  const ipLimit = showTestCode ? Math.max(engine.rateIpPerHour, 60) : engine.rateIpPerHour;
  const deviceLimit = showTestCode ? Math.max(engine.rateDevicePerHour, 120) : engine.rateDevicePerHour;
  const windowMs = 60 * 60 * 1000;

  const phoneRl = rateLimit(`otp-req-phone:${phone}`, { limit: phoneLimit, windowMs });
  if (!phoneRl.ok) {
    return NextResponse.json(
      { error: "تعداد درخواست کد فعالسازی بیش از حد مجاز است. لطفاً یک ساعت دیگر تلاش کنید." },
      { status: 429 },
    );
  }
  const ipRl = rateLimit(`otp-req-ip:${getClientIp(req)}`, { limit: ipLimit, windowMs });
  if (!ipRl.ok) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید." },
      { status: 429 },
    );
  }
  const deviceRl = rateLimit(`otp-req-device:${deviceId}`, { limit: deviceLimit, windowMs });
  if (!deviceRl.ok) {
    return NextResponse.json(
      { error: "تعداد درخواست‌ها از این دستگاه بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید." },
      { status: 429 },
    );
  }

  const respond = (payload: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(payload, { status });
    if (setCookie) res.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return res;
  };

  // ── TEST MODE ───────────────────────────────────────────────────────────
  if (showTestCode) {
    // Re-display the still-active code (same-code UX preserved).
    const activeCode = await getActiveOTPCode(phone);
    if (activeCode) {
      return respond({
        ok: true,
        sent: true,
        testMode: true,
        testCode: activeCode,
        reused: true,
        ttlSeconds: engine.ttlSeconds,
      });
    }
    // No display-cached code (first request, or cache lost after restart):
    // if a DB row is still active but uncached, REGENERATE so the fresh code
    // is visible (the old one is invalidated by overwrite).
    const outcome = await deliverOtp({ phone, purpose: "login", forDisplay: true });
    await audit({
      action: AuditActions.OTP_REQUEST,
      targetType: "phone",
      targetId: phone,
      req,
      meta: { testMode: true, providerSent: outcome.sent, providerId: outcome.providerId },
    });
    if (outcome.testCode) {
      return respond({
        ok: true,
        sent: true,
        testMode: true,
        testCode: outcome.testCode,
        ttlSeconds: outcome.ttlSeconds,
      });
    }
    // Should not happen in test mode — defensive error.
    return respond(
      { error: outcome.errorMessage ?? "خطا در صدور کد. لطفاً مجدداً تلاش کنید." },
      502,
    );
  }

  // ── REAL MODE ───────────────────────────────────────────────────────────
  // An active code blocks re-issuance (strict 429, unlike test mode).
  if (await hasActiveOTP(phone)) {
    return respond(
      { error: "کد قبلی هنوز معتبر است. لطفاً کمی صبر کنید." },
      429,
    );
  }

  // Enumeration protection: unknown phones still return 200 { sent:false }.
  const user = await db.user.findFirst({ where: { phone }, select: { id: true } });
  if (!user) {
    return respond({ ok: true, sent: false });
  }

  const outcome = await deliverOtp({ phone, purpose: "login" });
  if (!outcome.sent) {
    // Provider failure — meaningful Persian error (never the code/creds).
    return respond(
      { error: outcome.errorMessage ?? "ارسال پیامک ناموفق بود. لطفاً مجدداً تلاش کنید." },
      502,
    );
  }

  await audit({
    action: AuditActions.OTP_REQUEST,
    targetType: "phone",
    targetId: phone,
    req,
    meta: { sent: true, providerId: outcome.providerId, managed: outcome.managed },
  });

  return respond({ ok: true, sent: true, ttlSeconds: outcome.ttlSeconds });
}
