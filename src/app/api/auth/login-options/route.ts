import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isPasswordLoginEnabled, isSMSLoginEnabled } from "@/lib/login-settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/login-options
 *
 * PUBLIC endpoint used by the login pages to decide which login methods to
 * render (managed by the superadmin in «مدیریت ورود کاربر»):
 *
 *   { passwordEnabled: boolean, smsEnabled: boolean }
 *
 * No secrets are exposed — just two booleans.
 *
 * POST /api/auth/login-options  Body: { username?: string }
 *
 * Same two booleans + an `isSuperadmin` pre-check for a username. The login
 * pages use it AFTER a failed sign-in to render a precise Persian error:
 * when the username belongs to the SUPERADMIN account, the main /login page
 * tells the user to use /superadmin/login instead (and vice-versa). Only
 * the role is revealed for existing usernames — never password validity.
 */
async function readOptions() {
  // Fail-open defaults (true) mirror login-settings.ts so a DB hiccup
  // can never hide the login form entirely.
  const [passwordEnabled, smsEnabled] = await Promise.all([
    isPasswordLoginEnabled(),
    isSMSLoginEnabled(),
  ]);
  return { passwordEnabled, smsEnabled };
}

export async function GET() {
  try {
    return NextResponse.json(await readOptions());
  } catch {
    return NextResponse.json({ passwordEnabled: true, smsEnabled: true });
  }
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // No/invalid body → plain options response.
  }

  const options = await readOptions().catch(() => ({
    passwordEnabled: true,
    smsEnabled: true,
  }));

  const username = body?.username?.toString()?.trim()?.toLowerCase();
  if (!username) {
    return NextResponse.json(options);
  }

  try {
    const user = await db.user.findUnique({
      where: { username },
      select: { role: true },
    });
    return NextResponse.json({
      ...options,
      // False for unknown usernames too — no distinction is leaked.
      isSuperadmin: user?.role === "SUPERADMIN",
    });
  } catch {
    return NextResponse.json(options);
  }
}
