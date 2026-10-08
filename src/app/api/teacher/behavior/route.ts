import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf, verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/behavior
 *
 * Body JSON: { classId, studentId, type: "POSITIVE" | "NEGATIVE", reason, value? }
 *
 * Verifies the authenticated user is a TEACHER of the class, and that the
 * studentId is a STUDENT member of the class.
 * Permission gate: "set_behavior" (no-op for SUPERADMIN).
 * Returns the created behavior mark.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();
  await assertPermission(user.role, "set_behavior");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const classId: string | undefined = body?.classId;
  const studentId: string | undefined = body?.studentId;
  const type: string | undefined = body?.type;
  const reason: string | undefined = body?.reason;
  const valueRaw = body?.value ?? (type === "POSITIVE" ? 1 : -1);

  if (!classId) return badRequest("classId is required");
  if (!studentId) return badRequest("studentId is required");
  if (type !== "POSITIVE" && type !== "NEGATIVE") {
    return badRequest("type must be POSITIVE or NEGATIVE");
  }
  if (!reason || String(reason).trim().length === 0) {
    return badRequest("reason is required");
  }
  const value = Number(valueRaw);
  if (Number.isNaN(value) || !Number.isInteger(value)) {
    return badRequest("value must be an integer");
  }

  const teacherOf = await isTeacherOf(user.id, classId);
  if (!teacherOf && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // SECURITY (school scoping): an ADMIN (principal) may only mark behavior
  // in classes of their OWN school. SUPERADMIN stays unscoped.
  if (!teacherOf && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

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

  // For POSITIVE, value should typically be > 0; for NEGATIVE, < 0.
  // We'll coerce to a sensible sign so reports stay consistent.
  const signedValue =
    type === "POSITIVE" ? Math.abs(value) : -Math.abs(value);

  const mark = await db.behaviorMark.create({
    data: {
      classId,
      studentId,
      type,
      reason: String(reason).trim(),
      value: signedValue,
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
        id: mark.id,
        classId: mark.classId,
        studentId: mark.studentId,
        student: mark.student,
        type: mark.type,
        reason: mark.reason,
        value: mark.value,
        createdAt: mark.createdAt.toISOString(),
        createdBy: mark.createdBy,
      },
    },
    { status: 201 },
  );
});
