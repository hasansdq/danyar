import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/polls/[id]/close
 *
 * Closes the poll (sets closedAt = now). Idempotent — if already closed,
 * returns the poll unchanged.
 *
 * Authorization: the poll's creator OR a TEACHER of the class OR ADMIN.
 */
export const POST = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return notFound();

    const poll = await db.poll.findUnique({
      where: { id },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    if (!poll) {
      return notFound("نظرسنجی یافت نشد");
    }

    // Authorization: creator OR teacher of the class OR admin.
    const isCreator = poll.createdById === user.id;
    const teacherOf = await isTeacherOf(user.id, poll.classId);
    if (!isCreator && !teacherOf && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // SECURITY (school scoping): an ADMIN (principal) may only close polls
    // of classes in their OWN school (unless they created the poll).
    if (!isCreator && !teacherOf && user.role === "ADMIN") {
      const scopeError = await assertClassSchoolScope(user, poll.classId);
      if (scopeError) return scopeError;
    }

    // Idempotent: if already closed, just return.
    if (poll.closedAt) {
      return NextResponse.json({
        data: {
          id: poll.id,
          classId: poll.classId,
          question: poll.question,
          closed: true,
          closedAt: poll.closedAt.toISOString(),
          createdById: poll.createdById,
          createdBy: poll.createdBy,
        },
      });
    }

    const updated = await db.poll.update({
      where: { id },
      data: { closedAt: new Date() },
      include: {
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        classId: updated.classId,
        question: updated.question,
        closed: true,
        closedAt: updated.closedAt!.toISOString(),
        createdById: updated.createdById,
        createdBy: updated.createdBy,
      },
    });
  },
);
