import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyMembership } from "@/lib/membership";
import type { SessionUser } from "@/lib/api-auth";

/**
 * Shared school-scoping authorization for class-scoped resources.
 *
 * SECURITY (tenant isolation): an ADMIN is the principal of exactly ONE
 * school — every class-scoped operation must verify `class.schoolId ===
 * user.schoolId` for ADMINs. TEACHERs must be TEACHER members of the class.
 * SUPERADMINs are unscoped. STUDENTs are always rejected here (these checks
 * are for staff operations; student-facing routes use their own membership
 * checks).
 */

export interface ClassAuthzResult {
  error: NextResponse | null;
  cls: { id: string; name: string; schoolId: string | null } | null;
}

/**
 * Authorize a staff user (TEACHER/ADMIN/SUPERADMIN) for a class:
 *  - SUPERADMIN: allowed (unscoped)
 *  - ADMIN: class.schoolId must equal user.schoolId
 *  - TEACHER: must have a TEACHER ClassMembership in the class
 *  - STUDENT: rejected
 */
export async function authorizeStaffForClass(
  user: SessionUser,
  classId: string,
): Promise<ClassAuthzResult> {
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { id: true, name: true, schoolId: true },
  });
  if (!cls) {
    return { error: NextResponse.json({ error: "کلاس یافت نشد" }, { status: 404 }), cls: null };
  }
  if (user.role === "SUPERADMIN") return { error: null, cls };

  if (user.role === "ADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), cls: null };
    }
    return { error: null, cls };
  }

  if (user.role === "TEACHER") {
    const membership = await verifyMembership(user.id, classId);
    if (!membership || membership.role !== "TEACHER") {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), cls: null };
    }
    return { error: null, cls };
  }

  // STUDENT (and anything else)
  return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), cls: null };
}

/**
 * ADMIN (principal) school-scope check for a single record that has a
 * `class` relation — loads the class and compares schoolId. Pass a Prisma
 * include/where that resolves to the record's classId.
 */
export async function assertClassSchoolScope(
  user: SessionUser,
  classId: string,
): Promise<NextResponse | null> {
  if (user.role === "SUPERADMIN") return null;
  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { schoolId: true },
  });
  if (!cls || !user.schoolId || cls.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
