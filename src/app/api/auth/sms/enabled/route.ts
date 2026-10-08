import { NextResponse } from "next/server";
import { isSMSLoginEnabled } from "@/lib/login-settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/sms/enabled
 *
 * Public endpoint (no auth required) that returns whether SMS OTP login
 * is enabled. Kept for backward compatibility — the login pages now use
 * the richer /api/auth/login-options endpoint.
 *
 * NOTE: since the «مدیریت ورود کاربر» module, SMS login being enabled does
 * NOT require a real SMS provider — TEST MODE displays the code on the
 * login page instead of sending an SMS.
 *
 * Returns: { enabled: boolean }
 */
export async function GET() {
  try {
    const enabled = await isSMSLoginEnabled();
    return NextResponse.json({ enabled });
  } catch {
    return NextResponse.json({ enabled: false });
  }
}
