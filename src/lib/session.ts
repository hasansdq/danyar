import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Error classes thrown by the auth helpers below.
 *
 * In API routes you should catch these (or use the `apiRequire*` helpers) and
 * convert them to proper HTTP responses (401 / 403).
 *
 * In server components / pages, the helpers fall back to `redirect("/login")`
 * so the user is sent to the sign-in page automatically.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function getSession() {
  return getServerSession(authOptions);
}

export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Returns the authenticated user.
 *
 * IMPORTANT for API routes: this function throws `UnauthorizedError` when there
 * is no session. It does NOT redirect. That way API consumers can catch the
 * error and return a clean `401` JSON response.
 *
 * If you need a server-component-style redirect instead, use
 * `requireAuthOrRedirect()` below.
 */
export async function requireAuth() {
  const session = await getSession();
  if (!session?.user) {
    throw new UnauthorizedError();
  }
  return session.user;
}

export type Role = "STUDENT" | "TEACHER" | "ADMIN" | "SUPERADMIN";

/**
 * SUPERADMIN satisfies ANY role check — they are a superset of every role.
 * e.g. `requireRole("ADMIN")` passes for a SUPERADMIN.
 */
export async function requireRole(role: "STUDENT" | "TEACHER" | "ADMIN") {
  const user = await requireAuth();
  if (user.role !== role && user.role !== "SUPERADMIN") {
    throw new ForbiddenError(`Requires role ${role}`);
  }
  return user;
}

export async function requireAdmin() {
  return requireRole("ADMIN");
}

export async function requireTeacher() {
  return requireRole("TEACHER");
}

export async function requireStudent() {
  return requireRole("STUDENT");
}

/* ------------------------------------------------------------------ */
/* Server-component friendly variants (redirect on failure)           */
/* ------------------------------------------------------------------ */

export async function requireAuthOrRedirect() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireRoleOrRedirect(role: "STUDENT" | "TEACHER" | "ADMIN") {
  const user = await requireAuthOrRedirect();
  if (user.role !== role && user.role !== "SUPERADMIN") {
    redirect("/");
  }
  return user;
}

/**
 * SUPERADMIN-only check (server component variant). Redirects to
 * /superadmin/login if not a super admin.
 */
export async function requireSuperAdminOrRedirect() {
  const user = await requireAuthOrRedirect();
  if (user.role !== "SUPERADMIN") {
    redirect("/superadmin/login");
  }
  return user;
}
