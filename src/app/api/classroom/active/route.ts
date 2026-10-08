import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertClassSchoolScope } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * GET /api/classroom/active?classId=<id>
 *
 * Returns the active (status=live) ClassroomSession for the given class,
 * or null when there isn't one. Verifies the caller is a member of the
 * class (admins bypass with school-scoping).
 *
 * Response shape:
 *   { data: ClassroomSession | null }
 *   The session object includes `startedBy` (id/fullName/username/role/avatar).
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) return badRequest("classId is required");

  // Authorization: caller must be a member (admins bypass with school-scoping).
  const membership = await verifyMembership(user.id, classId);
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  if (!membership && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // SECURITY (school scoping): an ADMIN (principal) without membership may
  // only read the active session of classes in their OWN school. SUPERADMIN
  // stays unscoped.
  if (!membership && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  const session = await db.classroomSession.findFirst({
    where: { classId, status: "live" },
    include: {
      startedBy: {
        select: { id: true, fullName: true, username: true, role: true, avatar: true },
      },
    },
  });

  return NextResponse.json({ data: session });
});
