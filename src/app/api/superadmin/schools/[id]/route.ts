import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/superadmin/schools/[id]
 *
 * Returns a single school with principal info + counts.
 */
export async function GET(_req: NextRequest, ctx: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;

  const school = await db.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      address: true,
      principalId: true,
      streamingEnabled: true,
      createdAt: true,
      updatedAt: true,
      principal: {
        select: {
          id: true,
          username: true,
          fullName: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      },
      members: {
        where: { role: { in: ["TEACHER", "STUDENT"] } },
        select: { id: true, role: true },
      },
    },
  });

  if (!school) {
    return NextResponse.json({ error: "مدرسه یافت نشد" }, { status: 404 });
  }

  const teacherCount = school.members.filter((m) => m.role === "TEACHER").length;
  const studentCount = school.members.filter((m) => m.role === "STUDENT").length;
  const { members, ...rest } = school;

  return NextResponse.json({
    data: { ...rest, teacherCount, studentCount },
  });
}

/**
 * PATCH /api/superadmin/schools/[id]
 * Body: { name?, address? }
 */
export async function PATCH(req: NextRequest, ctx: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await db.school.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "مدرسه یافت نشد" }, { status: 404 });
  }

  const data: any = {};

  if (body?.name !== undefined) {
    const name = body.name.toString().trim();
    if (!name) {
      return NextResponse.json(
        { error: "نام مدرسه نمی‌تواند خالی باشد" },
        { status: 400 },
      );
    }
    if (name !== existing.name) {
      const clash = await db.school.findUnique({ where: { name } });
      if (clash && clash.id !== id) {
        return NextResponse.json(
          { error: "مدرسه‌ای با این نام قبلاً ثبت شده است" },
          { status: 409 },
        );
      }
    }
    data.name = name;
  }

  if (body?.address !== undefined) {
    const address = body.address ? body.address.toString().trim() : null;
    data.address = address;
  }

  // Phase 35b — per-school streaming (online class) toggle.
  if (body?.streamingEnabled !== undefined) {
    data.streamingEnabled = !!body.streamingEnabled;
  }

  const updated = await db.school.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      address: true,
      principalId: true,
      streamingEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: updated });
}

/**
 * DELETE /api/superadmin/schools/[id]
 *
 * Deletes a school. The principal relation is set to null (onDelete: SetNull).
 * School members' schoolId is set to null. Classes' schoolId is set to null.
 */
export async function DELETE(_req: NextRequest, ctx: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;

  const existing = await db.school.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "مدرسه یافت نشد" }, { status: 404 });
  }

  // Detach members + classes first (SetNull on the FKs would handle this at
  // the DB level, but we do it explicitly so the ordering is explicit and
  // Prisma's SQLite driver doesn't complain about referential integrity.
  await db.user.updateMany({
    where: { schoolId: id },
    data: { schoolId: null },
  });
  await db.classRoom.updateMany({
    where: { schoolId: id },
    data: { schoolId: null },
  });

  // Null out the principalId on the school row so the principal User is
  // no longer tied to this school (the principal User row stays intact).
  await db.school.update({
    where: { id },
    data: { principalId: null },
  });

  // AUDIT: school deletion (cascade: users detached, classes deleted).
  await audit({
    actor: { id: auth.user.id, username: auth.user.username, role: auth.user.role, schoolId: auth.user.schoolId ?? null },
    action: AuditActions.SCHOOL_DELETE,
    targetType: "school",
    targetId: id,
  });
  await db.school.delete({ where: { id } });

  return NextResponse.json({ data: { ok: true, id } });
}
