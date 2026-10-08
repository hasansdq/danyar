import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { isTeacherOf, verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "UNCHECKED",
  "DONE",
  "INCOMPLETE",
  "NOT_DONE",
]);

/**
 * POST /api/teacher/assignments/[id]/status
 *
 * Body JSON: { studentId, status, note? }
 *
 * Updates or creates the AssignmentSubmission row for the given
 * (assignmentId, studentId). Authorization: requester is a TEACHER of the
 * class, OR ADMIN, OR SUPERADMIN.
 *
 * Permission gate: "create_assignment" (no-op for SUPERADMIN).
 *
 * Validates:
 *   - assignment exists (404)
 *   - studentId is a STUDENT member of the assignment's class (400)
 *   - status ∈ {UNCHECKED, DONE, INCOMPLETE, NOT_DONE} (400)
 *
 * Returns { data: { assignmentId, studentId, status, note, updatedAt } }.
 */
export const POST = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return notFound();

    // Permission gate.
    await assertPermission(user.role, "create_assignment");

    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const studentId: string | undefined = body?.studentId;
    const statusRaw: string | undefined = body?.status;
    const noteRaw: string | undefined | null = body?.note;

    if (!studentId || typeof studentId !== "string") {
      return badRequest("studentId is required");
    }
    if (typeof statusRaw !== "string" || !VALID_STATUSES.has(statusRaw)) {
      return badRequest(
        "status must be one of UNCHECKED, DONE, INCOMPLETE, NOT_DONE",
      );
    }

    let note: string | null = null;
    if (noteRaw !== undefined && noteRaw !== null) {
      if (typeof noteRaw !== "string") {
        return badRequest("note must be a string");
      }
      const trimmed = noteRaw.trim();
      note = trimmed.length > 0 ? trimmed : null;
    }

    // Load assignment.
    const assignment = await db.assignment.findUnique({
      where: { id },
      select: { id: true, classId: true },
    });
    if (!assignment) return notFound("تکلیف یافت نشد");

    // Authorization: teacher of the class OR admin OR superadmin.
    const teacherOf = await isTeacherOf(user.id, assignment.classId);
    if (!teacherOf && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // SECURITY (school scoping): an ADMIN (principal) may only manage
    // submissions of classes in their OWN school. SUPERADMIN stays
    // unscoped.
    if (!teacherOf && user.role === "ADMIN") {
      const scopeError = await assertClassSchoolScope(user, assignment.classId);
      if (scopeError) return scopeError;
    }

    // Verify student is a STUDENT member of the class.
    const studentMembership = await verifyMembership(
      studentId,
      assignment.classId,
    );
    if (!studentMembership) {
      return NextResponse.json(
        { error: "دانش‌آموز عضو این کلاس نیست" },
        { status: 400 },
      );
    }
    if (studentMembership.role !== "STUDENT") {
      return NextResponse.json(
        { error: "کاربر هدف دانش‌آموز این کلاس نیست" },
        { status: 400 },
      );
    }

    // Upsert the submission row.
    const submission = await db.assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId: assignment.id,
          studentId,
        },
      },
      create: {
        assignmentId: assignment.id,
        studentId,
        status: statusRaw,
        note,
        updatedById: user.id,
      },
      update: {
        status: statusRaw,
        note,
        updatedById: user.id,
      },
      select: {
        assignmentId: true,
        studentId: true,
        status: true,
        note: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      data: {
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        status: submission.status,
        note: submission.note,
        updatedAt: submission.updatedAt.toISOString(),
      },
    });
  },
);
