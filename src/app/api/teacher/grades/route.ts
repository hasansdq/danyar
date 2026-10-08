import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf, verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/grades
 *
 * Body JSON: { classId, studentId, title, score, maxScore? }
 *
 * Verifies the authenticated user is a TEACHER of the class, and that the
 * studentId is a STUDENT member of the class.
 * Permission gate: "set_grades" (no-op for SUPERADMIN).
 * Returns the created grade.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "grades");

  await assertPermission(user.role, "set_grades");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const classId: string | undefined = body?.classId;
  const studentId: string | undefined = body?.studentId;
  const title: string | undefined = body?.title;
  const scoreRaw = body?.score;
  const maxScoreRaw = body?.maxScore ?? 20;

  if (!classId) return badRequest("classId is required");
  if (!studentId) return badRequest("studentId is required");
  if (!title || String(title).trim().length === 0) {
    return badRequest("title is required");
  }
  const score = Number(scoreRaw);
  if (Number.isNaN(score)) return badRequest("score must be a number");
  const maxScore = Number(maxScoreRaw);
  if (Number.isNaN(maxScore) || maxScore <= 0) {
    return badRequest("maxScore must be a positive number");
  }
  if (score < 0 || score > maxScore) {
    return badRequest("score must be between 0 and maxScore");
  }

  // Authorization: teacher of the class (or admin).
  const teacherOf = await isTeacherOf(user.id, classId);
  if (!teacherOf && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // SECURITY (school scoping): an ADMIN (principal) may only grade classes
  // of their OWN school. SUPERADMIN stays unscoped.
  if (!teacherOf && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  // Validate student is a member of the class (and is actually a student).
  const studentMembership = await verifyMembership(studentId, classId);
  if (!studentMembership) {
    return NextResponse.json(
      { error: "Student is not a member of this class" },
      { status: 400 },
    );
  }
  if (studentMembership.role !== "STUDENT") {
    return NextResponse.json(
      { error: "Target user is not a STUDENT in this class" },
      { status: 400 },
    );
  }

  const grade = await db.grade.create({
    data: {
      classId,
      studentId,
      title: String(title).trim(),
      score,
      maxScore,
      createdById: user.id,
    },
    include: {
      student: {
        select: { id: true, fullName: true, username: true },
      },
      createdBy: {
        select: { id: true, fullName: true, username: true },
      },
    },
  });

  return NextResponse.json(
    {
      data: {
        id: grade.id,
        classId: grade.classId,
        studentId: grade.studentId,
        student: grade.student,
        title: grade.title,
        score: grade.score,
        maxScore: grade.maxScore,
        createdAt: grade.createdAt.toISOString(),
        createdBy: grade.createdBy,
      },
    },
    { status: 201 },
  );
});
