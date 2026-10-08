import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { db } from "@/lib/db";
import { getNextAuthSecret } from "@/lib/env";
import { audit, AuditActions } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * SUPERADMIN impersonation endpoint.
 *
 * Lets the superadmin log in directly as any other user (no password needed).
 * Generates a fresh next-auth session JWT for the target user and sets the
 * session cookie, then returns the target user info + the redirect URL
 * appropriate for their role.
 *
 * Security:
 *   - Only SUPERADMIN can call this (requireSuperAdminApi).
 *   - The superadmin cannot impersonate another SUPERADMIN (defense against
 *     untraceable superadmin-to-superadmin takeovers).
 *   - Every impersonation is written to the AuditLog BEFORE the token is
 *     issued (actor, target, IP, user-agent).
 *   - The session cookie name/secure flag is derived from NEXTAUTH_URL so
 *     HTTPS deployments get the __Secure- prefixed, Secure cookie.
 *   - The new session cookie fully replaces the current one — the superadmin's
 *     original session is discarded. To return to the superadmin panel, log
 *     out and sign back in with superadmin credentials.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;
  const superadmin = auth.user;

  const { id: targetId } = await params;

  if (targetId === superadmin.id) {
    return NextResponse.json(
      { error: "نمی‌توانید به حساب خودتان وارد شوید" },
      { status: 400 }
    );
  }

  const target = await db.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      username: true,
      role: true,
      fullName: true,
      schoolId: true,
    },
  });

  if (!target) {
    return NextResponse.json(
      { error: "کاربر یافت نشد" },
      { status: 404 }
    );
  }

  const targetRole = target.role as "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";

  if (targetRole === "SUPERADMIN") {
    return NextResponse.json(
      { error: "جعل هویت کاربر سوپرادمین مجاز نیست" },
      { status: 403 }
    );
  }

  const secret = getNextAuthSecret();

  // Build the JWT token exactly like NextAuth's credentials provider does:
  // { id, role, username, name, schoolId }.
  const token = await encode({
    secret,
    token: {
      id: target.id,
      role: targetRole,
      username: target.username,
      name: target.fullName,
      schoolId: target.schoolId ?? null,
    },
    maxAge: 60 * 60 * 4, // 4 hours — impersonation sessions are shorter than normal sessions.
  });

  // Determine the landing page for the target user's role.
  let redirectTo = "/";
  if (target.role === "ADMIN") {
    // School principals land on the admin panel by default (they can also
    // visit / for the messenger).
    redirectTo = "/admin";
  } else {
    redirectTo = "/";
  }

  // AUDIT before issuing the token (never log the token itself).
  await audit({
    actor: {
      id: superadmin.id,
      username: superadmin.username,
      role: superadmin.role,
      schoolId: superadmin.schoolId ?? null,
    },
    action: AuditActions.IMPERSONATE,
    targetType: "user",
    targetId: target.id,
    req,
    meta: { targetUsername: target.username, targetRole: target.role },
  });

  const res = NextResponse.json({
    data: {
      id: target.id,
      username: target.username,
      fullName: target.fullName,
      role: target.role,
      redirectTo,
    },
  });

  // Set the next-auth session cookie with the right name/flags for the
  // deployment scheme: HTTPS (NEXTAUTH_URL starts with https://) uses the
  // __Secure- prefix + Secure flag; plain HTTP (e.g. behind an internal
  // gateway) uses the standard name.
  const isHttps = (process.env.NEXTAUTH_URL || "").startsWith("https://");
  const cookieName = isHttps ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  res.cookies.set({
    name: cookieName,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // keep in sync with the token maxAge above
    secure: isHttps,
  });

  return res;
}
