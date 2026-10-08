import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Loads the ClassRoom (with memberships + school) for `/api/classes/[id]/info`
 * and returns the public "group info" shape used by both GET + PATCH below.
 *
 * Reused by the PATCH handler so the updated row is returned with the exact
 * same shape as the GET response.
 */
async function loadGroupInfo(id: string) {
  const cls = await db.classRoom.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      gradeLevel: true,
      section: true,
      avatar: true,
      parentClassId: true,
      chatClosed: true,
      schoolId: true,
      memberships: {
        select: {
          id: true,
          role: true,
          user: {
            select: {
              id: true,
              fullName: true,
              username: true,
              role: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!cls) return null;

  const memberCount = cls.memberships.length;
  const studentCount = cls.memberships.filter(
    (m) => m.role === "STUDENT",
  ).length;
  const teacherCount = cls.memberships.filter(
    (m) => m.role === "TEACHER",
  ).length;

  return {
    id: cls.id,
    name: cls.name,
    description: cls.description,
    gradeLevel: cls.gradeLevel,
    section: cls.section,
    avatar: cls.avatar,
    parentClassId: cls.parentClassId,
    chatClosed: cls.chatClosed,
    members: cls.memberships.map((m) => ({
      id: m.user.id,
      fullName: m.user.fullName,
      username: m.user.username,
      role: m.user.role,
      avatar: m.user.avatar,
      membershipRole: m.role,
    })),
    memberCount,
    studentCount,
    teacherCount,
  };
}

/**
 * GET /api/classes/[id]/info
 *
 * Returns the public "group info" for the ClassRoom identified by [id]:
 *   { id, name, description, gradeLevel, section, avatar, parentClassId,
 *     chatClosed, members: [{ id, fullName, username, role, avatar,
 *     membershipRole }], memberCount, studentCount, teacherCount }.
 *
 * Auth: the requester must be a member of the class — OR an ADMIN principal
 * of the school that owns the class — OR a SUPERADMIN. Read-only info — we
 * don't enforce the per-role `chat` permission gate here (the user just
 * needs to be able to see the group info to render the chat header).
 */
export const GET = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return badRequest("شناسه کلاس الزامی است");

    // Quick existence check + school lookup so principals can be authorised.
    const cls = await db.classRoom.findUnique({
      where: { id },
      select: { schoolId: true },
    });
    if (!cls) {
      return NextResponse.json(
        { error: "کلاس یافت نشد" },
        { status: 404 },
      );
    }

    const membership = await verifyMembership(user.id, id);
    const isPrincipalOfClass =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      cls.schoolId === user.schoolId;
    const isSuperAdmin = user.role === "SUPERADMIN";

    if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const info = await loadGroupInfo(id);
    if (!info) {
      return NextResponse.json(
        { error: "کلاس یافت نشد" },
        { status: 404 },
      );
    }
    return NextResponse.json({ data: info });
  },
);

/**
 * PATCH /api/classes/[id]/info  body: { name?, description? }
 *
 * Updates the editable display fields of the ClassRoom (name + description).
 * Avatar is handled separately via POST/DELETE /api/classes/[id]/avatar
 * (multipart file upload — can't be done via JSON PATCH cleanly).
 *
 * Auth: isTeacherOf(classId) OR ADMIN principal of the school OR SUPERADMIN.
 * Returns the updated info in the same shape as GET.
 */
export const PATCH = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return badRequest("شناسه کلاس الزامی است");

    // Parse the JSON body — accept only `name` + `description`.
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    const existing = await db.classRoom.findUnique({
      where: { id },
      select: { id: true, name: true, schoolId: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "کلاس یافت نشد" },
        { status: 404 },
      );
    }

    // Authorization: teacher-of-class OR ADMIN principal of the school OR
    // SUPERADMIN. We check both paths in one block.
    const teacherOf = await verifyMembership(user.id, id);
    const isTeacherMember = !!teacherOf && teacherOf.role === "TEACHER";
    const isPrincipalOfClass =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      existing.schoolId === user.schoolId;
    const isSuperAdmin = user.role === "SUPERADMIN";

    if (!isTeacherMember && !isPrincipalOfClass && !isSuperAdmin) {
      return NextResponse.json(
        { error: "شما اجازه ویرایش این گروه را ندارید" },
        { status: 403 },
      );
    }

    // Build the update payload — only fields the caller actually provided.
    const data: { name?: string; description?: string | null } = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return badRequest("نام گروه نمی‌تواند خالی باشد");
      }
      // Enforce the global unique-name constraint (the schema has @unique on
      // ClassRoom.name). If the new name differs from the existing one and
      // is already taken by another class, refuse with 409.
      if (name !== existing.name) {
        const clash = await db.classRoom.findUnique({
          where: { name },
          select: { id: true },
        });
        if (clash && clash.id !== id) {
          return NextResponse.json(
            { error: "این نام قبلاً ثبت شده است" },
            { status: 409 },
          );
        }
      }
      data.name = name;
    }

    if (body?.description !== undefined) {
      const desc = body.description ? String(body.description).trim() : "";
      data.description = desc.length > 0 ? desc : null;
    }

    if (Object.keys(data).length === 0) {
      return badRequest("هیچ فیلدی برای ویرایش ارسال نشده است");
    }

    await db.classRoom.update({
      where: { id },
      data,
    });

    const info = await loadGroupInfo(id);
    if (!info) {
      return NextResponse.json(
        { error: "کلاس یافت نشد" },
        { status: 404 },
      );
    }
    return NextResponse.json({ data: info });
  },
);
