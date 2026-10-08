import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export type SessionUser = {
  id: string;
  role: "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";
  username: string;
  schoolId?: string | null;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

/**
 * Returns the current session user for an API route, or null if unauthenticated.
 */
export async function getApiUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  return session.user as SessionUser;
}

/**
 * Enforces admin role for API routes.
 * Returns either:
 *   - { user } when authenticated & authorized
 *   - { response } when not — caller should `return response`
 *
 * Usage:
 *   const auth = await requireAdminApi();
 *   if (auth.response) return auth.response;
 *   const user = auth.user;
 */
export async function requireAdminApi(): Promise<
  { user: SessionUser; response: null } | { user: null; response: NextResponse }
> {
  const user = await getApiUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return {
      user: null,
      response: NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 }),
    };
  }
  return { user, response: null };
}

/**
 * SUPERADMIN-only check for API routes.
 */
export async function requireSuperAdminApi(): Promise<
  { user: SessionUser; response: null } | { user: null; response: NextResponse }
> {
  const user = await getApiUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (user.role !== "SUPERADMIN") {
    return {
      user: null,
      response: NextResponse.json({ error: "Forbidden: super-admin role required" }, { status: 403 }),
    };
  }
  return { user, response: null };
}
