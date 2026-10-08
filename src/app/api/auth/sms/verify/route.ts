import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isSMSLoginEnabled, isTestCodeDisplayEnabled } from "@/lib/login-settings";
import { normalizePhone, isValidIranPhone } from "@/lib/sms/otp";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/sms/verify
 * Body: { phone: string, otp: string }
 *
 * Pre-validation helper called by the login page BEFORE the actual
 * `signIn("sms", { phone, otp })` (which performs the one-time-use OTP
 * verification inside the NextAuth provider — verifying here would consume
 * the code, so this route only checks PRE-conditions):
 *
 *  1. phone format is valid
 *  2. otp is 6 digits
 *  3. SMS login is enabled («مدیریت ورود کاربر»)
 *  4. In TEST MODE only: the phone must belong to exactly one account —
 *     returns a precise Persian error ("کاربری با این شماره یافت نشد" /
 *     "این شماره به چند حساب متصل است") so members understand why the
 *     sign-in would fail. In REAL mode this check is skipped to preserve
 *     phone-number enumeration protection.
 *
 * The client calls signIn("sms", ...) to complete the login.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phoneRaw = body?.phone?.toString()?.trim() ?? "";
  const otp = body?.otp?.toString()?.trim() ?? "";
  const phone = normalizePhone(phoneRaw);

  if (!isValidIranPhone(phone)) {
    return NextResponse.json(
      { error: "شماره موبایل نامعتبر است" },
      { status: 400 },
    );
  }

  if (otp.length !== 6) {
    return NextResponse.json(
      { error: "کد باید ۶ رقم باشد" },
      { status: 400 },
    );
  }

  const enabled = await isSMSLoginEnabled();
  if (!enabled) {
    return NextResponse.json(
      { error: "ورود پیامکی فعال نیست" },
      { status: 403 },
    );
  }

  // TEST MODE only: explain unregistered/ambiguous phones precisely.
  if (await isTestCodeDisplayEnabled()) {
    const users = await db.user.findMany({
      where: { phone },
      select: { id: true },
    });
    if (users.length === 0) {
      return NextResponse.json(
        {
          error:
            "کاربری با این شماره موبایل ثبت نشده است. شماره باید توسط مدیر در پروفایل حساب شما ثبت شود.",
        },
        { status: 404 },
      );
    }
    if (users.length > 1) {
      return NextResponse.json(
        { error: "این شماره موبایل به بیش از یک حساب متصل است. با مدیر سیستم تماس بگیرید." },
        { status: 409 },
      );
    }
  }

  // The actual OTP verification happens inside the NextAuth "sms"
  // provider's authorize() function. We just return "ok" here —
  // the client calls signIn("sms", { phone, otp }) to complete the login.
  return NextResponse.json({ ok: true, message: "Call signIn('sms', { phone, otp }) to complete login." });
}
