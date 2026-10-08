import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments/[id]/students
 *
 * Returns the assignment's STUDENT roster with each student's submission
 * status. Available to TEACHER/ADMIN/SUPERADMIN only (students get 403).
 *
 * Each item: { id, fullName, username, status, note, updatedAt } where
 * status defaults to "UNCHECKED" when no AssignmentSubmission row exists.
 *
 * Permission gate: "create_assignment" (teacher-side management gated by
 * create_assignment). SUPERADMIN bypasses.
 */
export const GET = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return notFound();

    // Students are not allowed to call this route.
    if (user.role === "STUDENT") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Permission gate (no-op for SUPERADMIN).
    await assertPermission(user.role, "create_assignment");

    const assignment = await db.assignment.findUnique({
      where: { id },
      select: { id: true, classId: true, title: true },
    });
    if (!assignment) return notFound("تکلیف یافت نشد");

    // Verify membership (admins/superadmins bypass since they may not be members).
    const membership = await verifyMembership(user.id, assignment.classId);
    if (!membership && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // SECURITY (school scoping): an ADMIN (principal) without membership may
    // only read submissions of classes in their OWN school. SUPERADMIN stays
    // unscoped.
    if (!membership && user.role === "ADMIN") {
      const scopeError = await assertClassSchoolScope(
        user,
        assignment.classId,
      );
      if (scopeError) return scopeError;
    }

    // Load all STUDENT members of the class with their submission row.
    const students = await db.classMembership.findMany({
      where: { classId: assignment.classId, role: "STUDENT" },
      select: {
        user: {
          select: {
            id: true,
            fullName: true,
            username: true,
            assignmentSubmissions: {
              where: { assignmentId: assignment.id },
              select: { status: true, note: true, updatedAt: true },
            },
          },
        },
      },
      orderBy: { user: { fullName: "asc" } },
    });

    const data = students.map((m) => {
      const sub = m.user.assignmentSubmissions[0];
      return {
        id: m.user.id,
        fullName: m.user.fullName,
        username: m.user.username,
        status: sub?.status ?? "UNCHECKED",
        note: sub?.note ?? null,
        updatedAt: sub?.updatedAt ? sub.updatedAt.toISOString() : null,
      };
    });

    return NextResponse.json({ data });
  },
);
