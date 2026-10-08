import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// DELETE /api/admin/assignments/[id]
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const auth = await requireAdminApi();
    if (auth.response) return auth.response;
    const user = auth.user;

    await assertPermission(user.role, "manage_content");

    const { id } = await ctx.params;

    const existing = await db.assignment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 },
      );
    }

    // SECURITY: school scoping — an ADMIN (principal) may only delete
    // records belonging to classes in their own school.
    if (user.role === "ADMIN") {
      const cls = await db.classRoom.findUnique({
        where: { id: existing.classId },
        select: { schoolId: true },
      });
      if (!cls || !user.schoolId || cls.schoolId !== user.schoolId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    await db.assignment.delete({ where: { id } });

    // Best-effort: delete the uploaded file from disk
    if (existing.fileUrl) {
      try {
        const fileName = existing.fileUrl.split("/").pop() || "";
        if (fileName) {
          const diskPath = path.join(
            process.cwd(),
            "public",
            "uploads",
            fileName,
          );
          await fs.unlink(diskPath);
        }
      } catch {
        // ignore
      }
    }

    return NextResponse.json({ data: { success: true, id } });
  },
);
