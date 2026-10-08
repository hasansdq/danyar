import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/grades?classId=<id>
 *
 * For STUDENTS: return only the calling user's own grades in that class.
 * For TEACHERS: return ALL students' grades in the class.
 * For ADMINS: behave like a teacher (sees all).
 *
 * Verifies membership.
 * Permission gate: "grades" for STUDENT role (no-op for SUPERADMIN).
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "grades");

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) return badRequest("classId is required");

  const membership = await verifyMembership(user.id, classId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (user.role === "STUDENT") {
    await assertPermission(user.role, "grades");
  }

  const isTeacher = membership.role === "TEACHER" || user.role === "ADMIN";

  const grades = await db.grade.findMany({
    where: {
      classId,
      // Students see only their own grades; teachers (and admins) see all.
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
    data: grades.map((g) => ({
      id: g.id,
      classId: g.classId,
      studentId: g.studentId,
      student: g.student,
      title: g.title,
      score: g.score,
      maxScore: g.maxScore,
      createdAt: g.createdAt.toISOString(),
      createdBy: g.createdBy,
    })),
  });
});
