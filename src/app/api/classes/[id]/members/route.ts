import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/classes/[id]/members
 *
 * Lists all members of the given class. Available to ANY member of the
 * class (teachers, students, admins who are members). Returns each
 * membership row with the user's id / username / fullName / role.
 *
 * Used by the messenger frontend's "ثبت نمره" and "ثبت نمره رفتاری"
 * dialogs to populate the student selector when a teacher is creating
 * a grade or behavior mark.
 */
export const GET = apiHandler<{ id: string }>(async (_req: NextRequest, ctx) => {
  const user = await requireAuth();
  const { id } = await ctx.params;

  const membership = await verifyMembership(user.id, id);
  // Admins who are not members still get read access (mirroring the
  // behavior of other messenger endpoints).
  if (!membership && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // SECURITY (school scoping): an ADMIN (principal) without membership may
  // only read the roster of classes in their OWN school. SUPERADMIN is
  // unscoped.
  const clsScope = await db.classRoom.findUnique({
    where: { id },
    select: { schoolId: true },
  });
  if (!clsScope) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (
    !membership &&
    user.role === "ADMIN" &&
    (!user.schoolId || clsScope.schoolId !== user.schoolId)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // SECURITY (PII): member phone numbers are only selected for staff
  // requesters — a TEACHER member of the class, an ADMIN scoped to the
  // class's school, or SUPERADMIN. STUDENT requesters get the roster
  // without phone numbers.
  const canSeePhones =
    user.role === "SUPERADMIN" ||
    membership?.role === "TEACHER" ||
    (user.role === "ADMIN" &&
      !!user.schoolId &&
      clsScope.schoolId === user.schoolId);

  const cls = await db.classRoom.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      memberships: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
              ...(canSeePhones ? { phone: true } : {}),
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const data = cls.memberships.map((m) => ({
    id: m.id,
    classId: cls.id,
    userId: m.user.id,
    username: m.user.username,
    fullName: m.user.fullName,
    role: m.role, // membership role (STUDENT/TEACHER)
    userRole: m.user.role, // user-level role (STUDENT/TEACHER/ADMIN)
    createdAt: m.createdAt.toISOString(),
  }));

  return NextResponse.json({ data });
});
