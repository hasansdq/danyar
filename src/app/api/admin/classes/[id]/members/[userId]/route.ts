import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

// DELETE /api/admin/classes/[id]/members/[userId]
export async function DELETE(
  _req: NextRequest,
  { params }: Params,
) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { id, userId } = await params;

  const existing = await db.classMembership.findUnique({
    where: { classId_userId: { classId: id, userId } },
  });

  if (!existing) {
    return NextResponse.json({ error: "Membership not found" }, { status: 404 });
  }

  // SECURITY: school scoping — an ADMIN (principal) may only remove members
  // from classes in their own school.
  if (auth.user.role === "ADMIN") {
    const cls = await db.classRoom.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!cls || !auth.user.schoolId || cls.schoolId !== auth.user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  await db.classMembership.delete({
    where: { classId_userId: { classId: id, userId } },
  });

  return NextResponse.json({
    data: { success: true, classId: id, userId },
  });
}
