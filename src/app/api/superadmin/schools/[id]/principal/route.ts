import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/superadmin/schools/[id]/principal
 * Body: { userId }
 *
 * Assigns a user as the principal of this school. The user must have role ADMIN
 * (they become the school principal).
 *   - Sets `user.schoolId = school.id` (the principal belongs to the school)
 *   - Sets `school.principalId = userId`
 *
 * If the user was already a principal of another school, the @unique constraint
 * on School.principalId fires (P2002) → 409 with the Persian message
 * "این کاربر مدیر مدرسه دیگری است". A user can only be principal of one
 * school — to "move" them, first PATCH their old school to clear principalId.
 *
 * Returns the updated school with principal info.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = (body?.userId || "").toString().trim();
  if (!userId) {
    return NextResponse.json(
      { error: "userId الزامی است" },
      { status: 400 },
    );
  }

  const school = await db.school.findUnique({ where: { id } });
  if (!school) {
    return NextResponse.json({ error: "مدرسه یافت نشد" }, { status: 404 });
  }

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json(
      { error: "کاربر یافت نشد" },
      { status: 400 },
    );
  }
  if (user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "فقط کاربران با نقش مدیر می‌توانند مدیر مدرسه شوند" },
      { status: 400 },
    );
  }

  // Assign the user as the principal of THIS school and attach them as a member
  // in a single transaction. If the user was already a principal elsewhere, the
  // @unique constraint on School.principalId fires (P2002) — we surface a 409
  // with a Persian message so the caller can first unset them from the old
  // school.
  try {
    await db.$transaction([
      db.user.update({
        where: { id: userId },
        data: { schoolId: id },
      }),
      db.school.update({
        where: { id },
        data: { principalId: userId },
      }),
    ]);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (
      code === "P2002" ||
      (err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002")
    ) {
      return NextResponse.json(
        { error: "این کاربر مدیر مدرسه دیگری است" },
        { status: 409 },
      );
    }
    throw err;
  }

  const updated = await db.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      principalId: true,
      createdAt: true,
      updatedAt: true,
      principal: {
        select: {
          id: true,
          username: true,
          fullName: true,
          phone: true,
          role: true,
        },
      },
    },
  });

  return NextResponse.json({ data: updated });
}
