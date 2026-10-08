import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type BulkGradeInput = {
  studentId: string;
  score: number;
  maxScore?: number;
};

/**
 * POST /api/teacher/grades/bulk
 * Body JSON: { classId, examTitle: string, grades: [{ studentId, score, maxScore? }] }
 *
 * Bulk grade entry: a teacher enters one exam title + a list of
 * { studentId, score, maxScore? } entries for all students in the class
 * at once. Creates one Grade row per entry inside a transaction.
 *
 * Authorization: TEACHER of the class (admins/superadmins bypass via the
 * isTeacherOf OR ADMIN rule).
 * Permission gate: "set_grades" (no-op for SUPERADMIN).
 *
 * Validations:
 *  - examTitle non-empty.
 *  - every studentId is a STUDENT member of the class (400 otherwise).
 *  - 0 <= score <= (maxScore || 20) per entry.
 *
 * Returns { data: { count, grades: [{ id, classId, studentId, score, maxScore, title }] } }.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();
  await assertPermission(user.role, "set_grades");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const classId: string | undefined = body?.classId;
  const examTitle: string | undefined = body?.examTitle;
  const gradesRaw: unknown = body?.grades;

  if (!classId) return badRequest("classId is required");
  if (typeof examTitle !== "string" || examTitle.trim().length === 0) {
    return badRequest("examTitle is required");
  }
  if (!Array.isArray(gradesRaw) || gradesRaw.length === 0) {
    return badRequest("grades must be a non-empty array");
  }

  // Authorization: teacher of the class OR admin.
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

  // Verify class exists.
  const cls = await db.classRoom.findUnique({ where: { id: classId } });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // Parse + validate every grade entry.
  const parsed: BulkGradeInput[] = [];
  for (let i = 0; i < gradesRaw.length; i++) {
    const entry = gradesRaw[i] as any;
    if (!entry || typeof entry !== "object") {
      return badRequest(`grades[${i}] must be an object`);
    }
    const studentId: string | undefined = entry.studentId;
    const scoreNum = Number(entry.score);
    const maxScoreNum =
      entry.maxScore === undefined || entry.maxScore === null
        ? 20
        : Number(entry.maxScore);
    if (!studentId || typeof studentId !== "string") {
      return badRequest(`grades[${i}].studentId is required`);
    }
    if (Number.isNaN(scoreNum)) {
      return badRequest(`grades[${i}].score must be a number`);
    }
    if (Number.isNaN(maxScoreNum) || maxScoreNum <= 0) {
      return badRequest(`grades[${i}].maxScore must be a positive number`);
    }
    if (scoreNum < 0 || scoreNum > maxScoreNum) {
      return badRequest(
        `grades[${i}].score must be between 0 and maxScore`,
      );
    }
    parsed.push({ studentId, score: scoreNum, maxScore: maxScoreNum });
  }

  // Verify every studentId is a STUDENT member of the class. Fetch all
  // STUDENT memberships for the class in one query.
  const studentMemberships = await db.classMembership.findMany({
    where: { classId, role: "STUDENT" },
    select: { userId: true },
  });
  const validStudentIds = new Set(studentMemberships.map((m) => m.userId));

  const invalidStudents = parsed
    .map((g) => g.studentId)
    .filter((id) => !validStudentIds.has(id));
  if (invalidStudents.length > 0) {
    return NextResponse.json(
      {
        error:
          "برخی از دانش‌آموزان عضو این کلاس نیستند",
        invalidStudentIds: Array.from(new Set(invalidStudents)),
      },
      { status: 400 },
    );
  }

  // Create all grades inside a transaction.
  const trimmedTitle = examTitle.trim();
  const created: {
    id: string;
    classId: string;
    studentId: string;
    score: number;
    maxScore: number;
    title: string;
    createdAt: string;
    createdById: string;
  }[] = [];

  await db.$transaction(async (tx) => {
    for (const g of parsed) {
      const grade = await tx.grade.create({
        data: {
          classId,
          studentId: g.studentId,
          title: trimmedTitle,
          score: g.score,
          maxScore: g.maxScore,
          createdById: user.id,
        },
        select: {
          id: true,
          classId: true,
          studentId: true,
          score: true,
          maxScore: true,
          title: true,
          createdAt: true,
          createdById: true,
        },
      });
      created.push({
        id: grade.id,
        classId: grade.classId,
        studentId: grade.studentId,
        score: grade.score,
        maxScore: grade.maxScore,
        title: grade.title,
        createdAt: grade.createdAt.toISOString(),
        createdById: grade.createdById,
      });
    }
  });

  return NextResponse.json(
    {
      data: {
        count: created.length,
        examTitle: trimmedTitle,
        grades: created,
      },
    },
    { status: 201 },
  );
});
