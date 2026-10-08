import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/superadmin/schools/[id]/members
 *
 * Returns `{ principal, teachers[], students[] }` for the given school.
 */
export async function GET(_req: NextRequest, ctx: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;

  const school = await db.school.findUnique({
    where: { id },
    select: {
      id: true,
      principalId: true,
      principal: {
        select: {
          id: true,
          username: true,
          fullName: true,
          phone: true,
          role: true,
          avatar: true,
          createdAt: true,
        },
      },
    },
  });

  if (!school) {
    return NextResponse.json({ error: "مدرسه یافت نشد" }, { status: 404 });
  }

  const [teachers, students] = await Promise.all([
    db.user.findMany({
      where: { schoolId: id, role: "TEACHER" },
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        avatar: true,
        createdAt: true,
      },
      orderBy: { fullName: "asc" },
    }),
    db.user.findMany({
      where: { schoolId: id, role: "STUDENT" },
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        avatar: true,
        createdAt: true,
      },
      orderBy: { fullName: "asc" },
    }),
  ]);

  return NextResponse.json({
    data: {
      principal: school.principal,
      teachers,
      students,
    },
  });
}
