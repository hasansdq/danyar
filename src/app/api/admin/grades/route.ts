import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

// GET /api/admin/grades?classId=...
// Lists grades (optionally filtered by class). Includes student + class info.
// Admin-only.
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const classId = url.searchParams.get("classId") || undefined;

  const grades = await db.grade.findMany({
    // SECURITY: school scoping — an ADMIN (principal) only sees records of
    // their own school's classes (SUPERADMIN stays unscoped).
    where: classId
      ? { classId, ...(auth.user.role === "ADMIN" ? { class: { schoolId: auth.user.schoolId ?? "__none__" } } : {}) }
      : auth.user.role === "ADMIN"
        ? { class: { schoolId: auth.user.schoolId ?? "__none__" } }
        : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      class: { select: { id: true, name: true, gradeLevel: true, section: true } },
      student: { select: { id: true, fullName: true, username: true } },
      createdBy: { select: { id: true, fullName: true, username: true, role: true } },
    },
  });

  return NextResponse.json({
    data: grades.map((g) => ({
      id: g.id,
      classId: g.classId,
      class: g.class,
      studentId: g.studentId,
      student: g.student,
      title: g.title,
      score: g.score,
      maxScore: g.maxScore,
      createdAt: g.createdAt.toISOString(),
      createdBy: g.createdBy,
    })),
  });
}

// POST /api/admin/grades  body: { classId, studentId, title, score, maxScore?, createdById }
export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  await assertPermission(user.role, "manage_content");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const classId = (body?.classId || "").toString().trim();
  const studentId = (body?.studentId || "").toString().trim();
  const title = (body?.title || "").toString().trim();
  const createdById = (body?.createdById || "").toString().trim();

  const score = Number(body?.score);
  const maxScore =
    body?.maxScore === undefined || body?.maxScore === null
      ? 20
      : Number(body.maxScore);

  if (!classId || !studentId || !title || !createdById) {
    return NextResponse.json(
      { error: "classId, studentId, title, createdById are required" },
      { status: 400 },
    );
  }
  if (Number.isNaN(score) || Number.isNaN(maxScore)) {
    return NextResponse.json(
      { error: "score and maxScore must be numbers" },
      { status: 400 },
    );
  }
  if (score < 0 || maxScore <= 0) {
    return NextResponse.json(
      { error: "score must be >= 0 and maxScore must be > 0" },
      { status: 400 },
    );
  }

  const [cls, student, createdBy] = await Promise.all([
    db.classRoom.findUnique({ where: { id: classId } }),
    db.user.findUnique({ where: { id: studentId } }),
    db.user.findUnique({ where: { id: createdById } }),
  ]);
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (!createdBy) {
    return NextResponse.json({ error: "Creator user not found" }, { status: 404 });
  }

  // SECURITY (school scoping + attribution): an ADMIN (principal) may only
  // create records for classes in their OWN school, and the attributed
  // creator must belong to that same school (blocks cross-school attribution
  // forgery). SUPERADMIN stays unscoped.
  if (user.role === "ADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (createdBy.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden: creator must be in your school" }, { status: 403 });
    }
  }

  const grade = await db.grade.create({
    data: { classId, studentId, title, score, maxScore, createdById },
    select: {
      id: true,
      classId: true,
      studentId: true,
      title: true,
      score: true,
      maxScore: true,
      createdAt: true,
      createdById: true,
    },
  });

  return NextResponse.json({ data: grade }, { status: 201 });
});
