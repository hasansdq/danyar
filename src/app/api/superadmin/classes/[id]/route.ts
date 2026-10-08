import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/superadmin/classes/[id]
 * Returns the class with all members + school info.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  const cls = await db.classRoom.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      gradeLevel: true,
      section: true,
      schoolId: true,
      chatClosed: true,
      chatClosedAt: true,
      fileUploadEnabled: true,
      maxFileSizeMb: true,
      allowedFileTypes: true,
      createdAt: true,
      updatedAt: true,
      school: { select: { id: true, name: true } },
      memberships: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const studentCount = cls.memberships.filter((m) => m.role === "STUDENT").length;
  const teacherCount = cls.memberships.filter((m) => m.role === "TEACHER").length;

  return NextResponse.json({
    data: {
      ...cls,
      studentCount,
      teacherCount,
    },
  });
}

/**
 * PATCH /api/superadmin/classes/[id]
 * Body: { name?, description?, gradeLevel?, section?, schoolId? }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const existing = await db.classRoom.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const data: any = {};

  if (body?.name !== undefined) {
    const name = body.name.toString().trim();
    if (!name) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }
    if (name !== existing.name) {
      const clash = await db.classRoom.findUnique({ where: { name } });
      if (clash && clash.id !== id) {
        return NextResponse.json(
          { error: "Class name already exists" },
          { status: 409 },
        );
      }
    }
    data.name = name;
  }

  if (body?.description !== undefined) {
    data.description = body.description
      ? body.description.toString().trim()
      : null;
  }

  if (body?.gradeLevel !== undefined) {
    data.gradeLevel = body.gradeLevel
      ? body.gradeLevel.toString().trim()
      : null;
  }

  if (body?.section !== undefined) {
    data.section = body.section ? body.section.toString().trim() : null;
  }

  if (body?.schoolId !== undefined) {
    const schoolIdRaw = body.schoolId
      ? body.schoolId.toString().trim()
      : null;
    if (schoolIdRaw) {
      const school = await db.school.findUnique({ where: { id: schoolIdRaw } });
      if (!school) {
        return NextResponse.json(
          { error: "مدرسه مورد نظر یافت نشد" },
          { status: 400 },
        );
      }
      data.schoolId = schoolIdRaw;
    } else {
      // null = un-affiliate
      data.schoolId = null;
    }
  }

  const updated = await db.classRoom.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      description: true,
      gradeLevel: true,
      section: true,
      schoolId: true,
      createdAt: true,
      updatedAt: true,
      school: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: updated });
}

/**
 * DELETE /api/superadmin/classes/[id]
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;

  const existing = await db.classRoom.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  await db.classRoom.delete({ where: { id } });

  return NextResponse.json({ data: { success: true, id } });
}
