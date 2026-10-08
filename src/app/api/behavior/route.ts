import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/behavior?classId=<id>
 *
 * For STUDENTS: return only the calling user's own behavior marks in that class.
 * For TEACHERS: return ALL students' behavior marks in the class.
 * For ADMINS: behave like a teacher (sees all).
 *
 * Verifies membership. Includes the student name.
 * Permission gate: "behavior" for STUDENT role (no-op for SUPERADMIN).
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) return badRequest("classId is required");

  const membership = await verifyMembership(user.id, classId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (user.role === "STUDENT") {
    await assertPermission(user.role, "behavior");
  }

  const isTeacher = membership.role === "TEACHER" || user.role === "ADMIN";

  const marks = await db.behaviorMark.findMany({
    where: {
      classId,
      ...(isTeacher ? {} : { studentId: user.id }),
    },
    orderBy: { createdAt: "desc" },
    include: {
      student: {
        select: { id: true, fullName: true, username: true },
      },
      createdBy: {
        select: { id: true, fullName: true, username: true },
      },
    },
  });

  return NextResponse.json({
    data: marks.map((b) => ({
      id: b.id,
      classId: b.classId,
      studentId: b.studentId,
      student: b.student,
      type: b.type,
      reason: b.reason,
      value: b.value,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy,
    })),
  });
});
