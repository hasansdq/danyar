import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/assignments/[id]
 * Returns a single assignment by id. Verifies the requesting user is a member
 * of the assignment's class.
 */
export const GET = apiHandler<{ id: string }>(
  async (_req, ctx) => {
    const user = await requireAuth();

    const { id } = await ctx.params;
    if (!id) return notFound();

    const assignment = await db.assignment.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { id: true, fullName: true, username: true, role: true },
        },
        class: { select: { id: true, name: true } },
      },
    });

    if (!assignment) return notFound();

    const membership = await verifyMembership(user.id, assignment.classId);
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      data: {
        id: assignment.id,
        classId: assignment.classId,
        class: assignment.class,
        title: assignment.title,
        description: assignment.description,
        dueDate: assignment.dueDate ? assignment.dueDate.toISOString() : null,
        fileName: assignment.fileName,
        fileUrl: assignment.fileUrl,
        fileSize: assignment.fileSize,
        createdAt: assignment.createdAt.toISOString(),
        createdBy: assignment.createdBy,
      },
    });
  },
);
