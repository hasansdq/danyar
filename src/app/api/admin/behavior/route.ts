import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

const VALID_TYPES = new Set(["POSITIVE", "NEGATIVE"]);

// GET /api/admin/behavior?classId=...
// Lists behavior marks (optionally filtered by class). Includes student + class info.
// Admin-only.
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const classId = url.searchParams.get("classId") || undefined;

  const marks = await db.behaviorMark.findMany({
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
    data: marks.map((b) => ({
      id: b.id,
      classId: b.classId,
      class: b.class,
      studentId: b.studentId,
      student: b.student,
      type: b.type,
      reason: b.reason,
      value: b.value,
      createdAt: b.createdAt.toISOString(),
      createdBy: b.createdBy,
    })),
  });
}

// POST /api/admin/behavior  body: { classId, studentId, type: POSITIVE|NEGATIVE, reason, value?, createdById }
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
  const type = (body?.type || "").toString().toUpperCase();
  const reason = (body?.reason || "").toString().trim();
  const createdById = (body?.createdById || "").toString().trim();

  let value: number;
  if (body?.value === undefined || body?.value === null) {
    value = type === "POSITIVE" ? 1 : -1;
  } else {
    value = Number(body.value);
  }

  if (!classId || !studentId || !reason || !createdById || !type) {
    return NextResponse.json(
      { error: "classId, studentId, type, reason, createdById are required" },
      { status: 400 },
    );
  }
  if (!VALID_TYPES.has(type)) {
    return NextResponse.json(
      { error: "type must be POSITIVE or NEGATIVE" },
      { status: 400 },
    );
  }
  if (Number.isNaN(value)) {
    return NextResponse.json({ error: "value must be a number" }, { status: 400 });
  }
  // SECURITY: bound the magnitude/sign of behavior marks (|value| <= 100 and
  // the sign must match the type — POSITIVE >= 0, NEGATIVE <= 0).
  if (Math.abs(value) > 100 || (type === "POSITIVE" && value < 0) || (type === "NEGATIVE" && value > 0)) {
    return NextResponse.json({ error: "value out of range (|value| <= 100, sign must match type)" }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: "reason too long (max 500 chars)" }, { status: 400 });
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

  const mark = await db.behaviorMark.create({
    data: { classId, studentId, type, reason, value, createdById },
    select: {
      id: true,
      classId: true,
      studentId: true,
      type: true,
      reason: true,
      value: true,
      createdAt: true,
      createdById: true,
    },
  });

  return NextResponse.json({ data: mark }, { status: 201 });
});
