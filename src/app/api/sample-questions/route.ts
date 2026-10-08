import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/sample-questions?classId=<id>
 * Returns sample questions for the class, newest first. Verifies membership.
 * Includes createdBy name.
 * Permission gate: "sample_questions" for STUDENT role (no-op for SUPERADMIN).
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "sample_questions");

  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId) return badRequest("classId is required");

  const membership = await verifyMembership(user.id, classId);
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (user.role === "STUDENT") {
    await assertPermission(user.role, "sample_questions");
  }

  const questions = await db.sampleQuestion.findMany({
    where: { classId },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: {
        select: { id: true, fullName: true, username: true, role: true },
      },
    },
  });

  return NextResponse.json({
    data: questions.map((q) => ({
      id: q.id,
      classId: q.classId,
      title: q.title,
      description: q.description,
      fileName: q.fileName,
      fileUrl: q.fileUrl,
      createdAt: q.createdAt.toISOString(),
      createdBy: q.createdBy,
    })),
  });
});
