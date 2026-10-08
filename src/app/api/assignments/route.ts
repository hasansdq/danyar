import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments?classId=<id>
 *
 * Returns assignments for the class, newest first. Verifies membership.
 * Includes:
 *   - createdBy { id, fullName, username, role }
 *   - class { id, name, section }
 *   - For STUDENT role: myStatus (string, default "UNCHECKED")
 *   - For TEACHER/ADMIN/SUPERADMIN: submissionCounts
 *     { UNCHECKED, DONE, INCOMPLETE, NOT_DONE }
 *
 * Permission gate: STUDENT → "assignments".
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "assignments");

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) return badRequest("classId is required");

  const membership = await verifyMembership(user.id, classId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Permission gate: students need the "assignments" feature enabled.
  if (user.role === "STUDENT") {
    await assertPermission(user.role, "assignments");
  }

  const assignments = await db.assignment.findMany({
    where: { classId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: { id: true, fullName: true, username: true, role: true },
      },
      class: { select: { id: true, name: true, section: true } },
      submissions: {
        // For students, only their own row; for teachers/admins all rows
        // (we'll aggregate counts below).
        where:
          user.role === "STUDENT" ? { studentId: user.id } : undefined,
        select: { studentId: true, status: true },
      },
    },
  });

  const isStudent = user.role === "STUDENT";

  return NextResponse.json({
    data: assignments.map((a) => {
      // Default myStatus to "UNCHECKED" when no row exists.
      const myStatus = isStudent
        ? a.submissions.find((s) => s.studentId === user.id)?.status ??
          "UNCHECKED"
        : undefined;

      // Build submission counts for teachers/admins.
      let submissionCounts:
        | {
            UNCHECKED: number;
            DONE: number;
            INCOMPLETE: number;
            NOT_DONE: number;
          }
        | undefined;
      if (!isStudent) {
        // For teachers/admins we queried all submissions via the include.
        // But the include had where undefined here so all rows are present.
        const counts = {
          UNCHECKED: 0,
          DONE: 0,
          INCOMPLETE: 0,
          NOT_DONE: 0,
        };
        for (const s of a.submissions) {
          if (s.status === "DONE") counts.DONE += 1;
          else if (s.status === "INCOMPLETE") counts.INCOMPLETE += 1;
          else if (s.status === "NOT_DONE") counts.NOT_DONE += 1;
          else counts.UNCHECKED += 1;
        }
        submissionCounts = counts;
      }

      return {
        id: a.id,
        classId: a.classId,
        class: a.class,
        title: a.title,
        description: a.description,
        dueDate: a.dueDate ? a.dueDate.toISOString() : null,
        fileName: a.fileName,
        fileUrl: a.fileUrl,
        fileSize: a.fileSize,
        createdAt: a.createdAt.toISOString(),
        createdBy: a.createdBy,
        ...(isStudent ? { myStatus } : { submissionCounts }),
      };
    }),
  });
});
