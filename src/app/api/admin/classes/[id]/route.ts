import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import {
  parseAllowedFileTypes,
  serializeAllowedFileTypes,
  isValidAllowedFileTypes,
  type AllowedFileTypes,
} from "@/lib/file-settings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/classes/[id]
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const requester = auth.user;

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
            select: { id: true, username: true, fullName: true, role: true, phone: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  if (requester.role === "ADMIN") {
    if (!requester.schoolId || cls.schoolId !== requester.schoolId) {
      return NextResponse.json(
        { error: "شما فقط کلاس‌های مدرسه خود را می‌توانید مشاهده کنید" },
        { status: 403 },
      );
    }
  }

  const studentCount = cls.memberships.filter((m) => m.role === "STUDENT").length;
  const teacherCount = cls.memberships.filter((m) => m.role === "TEACHER").length;

  return NextResponse.json({
    data: {
      ...cls,
      allowedFileTypes: parseAllowedFileTypes(cls.allowedFileTypes),
      studentCount,
      teacherCount,
    },
  });
}

// PATCH /api/admin/classes/[id]  body: { name?, description?, gradeLevel?, section? }
export const PATCH = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const auth = await requireAdminApi();
    if (auth.response) return auth.response;
    const requester = auth.user;

    await assertPermission(requester.role, "manage_classes");

    const { id } = await ctx.params;

    const existing = await db.classRoom.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    if (requester.role === "ADMIN") {
      if (!requester.schoolId || existing.schoolId !== requester.schoolId) {
        return NextResponse.json(
          { error: "شما فقط کلاس‌های مدرسه خود را می‌توانید ویرایش کنید" },
          { status: 403 },
        );
      }
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const data: any = {};

    if (body?.name !== undefined) {
      const name = body.name.toString().trim();
      if (!name) {
        return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      }
      if (name !== existing.name) {
        const clash = await db.classRoom.findUnique({ where: { name } });
        if (clash && clash.id !== id) {
          return NextResponse.json({ error: "Class name already exists" }, { status: 409 });
        }
      }
      data.name = name;
    }

    if (body?.description !== undefined) {
      data.description = body.description ? body.description.toString().trim() : null;
    }

    if (body?.gradeLevel !== undefined) {
      data.gradeLevel = body.gradeLevel ? body.gradeLevel.toString().trim() : null;
    }

    if (body?.section !== undefined) {
      data.section = body.section ? body.section.toString().trim() : null;
    }

    // ---- Per-class file-upload settings ----
    if (body?.fileUploadEnabled !== undefined) {
      if (typeof body.fileUploadEnabled !== "boolean") {
        return NextResponse.json(
          { error: "fileUploadEnabled must be a boolean" },
          { status: 400 },
        );
      }
      data.fileUploadEnabled = body.fileUploadEnabled;
    }

    if (body?.maxFileSizeMb !== undefined) {
      const raw = body.maxFileSizeMb;
      if (
        typeof raw !== "number" ||
        !Number.isInteger(raw) ||
        raw < 0
      ) {
        return NextResponse.json(
          {
            error:
              "maxFileSizeMb must be a non-negative integer (megabytes, 0 = no limit)",
          },
          { status: 400 },
        );
      }
      data.maxFileSizeMb = raw;
    }

    if (body?.allowedFileTypes !== undefined) {
      const value = body.allowedFileTypes as AllowedFileTypes;
      if (value === null) {
        data.allowedFileTypes = null;
      } else if (Array.isArray(value)) {
        if (!isValidAllowedFileTypes(value)) {
          return NextResponse.json(
            {
              error:
                'allowedFileTypes must be an array of strings from ["image","pdf","video","file"] (or null)',
            },
            { status: 400 },
          );
        }
        data.allowedFileTypes = serializeAllowedFileTypes(value);
      } else {
        return NextResponse.json(
          { error: "allowedFileTypes must be an array of strings or null" },
          { status: 400 },
        );
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
        fileUploadEnabled: true,
        maxFileSizeMb: true,
        allowedFileTypes: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      data: {
        ...updated,
        allowedFileTypes: parseAllowedFileTypes(updated.allowedFileTypes),
      },
    });
  },
);

// DELETE /api/admin/classes/[id]
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const auth = await requireAdminApi();
    if (auth.response) return auth.response;
    const requester = auth.user;

    await assertPermission(requester.role, "manage_classes");

    const { id } = await ctx.params;

    const existing = await db.classRoom.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    if (requester.role === "ADMIN") {
      if (!requester.schoolId || existing.schoolId !== requester.schoolId) {
        return NextResponse.json(
          { error: "شما فقط کلاس‌های مدرسه خود را می‌توانید حذف کنید" },
          { status: 403 },
        );
      }
    }

    await db.classRoom.delete({ where: { id } });

    return NextResponse.json({ data: { success: true, id } });
  },
);
