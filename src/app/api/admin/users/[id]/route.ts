import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["STUDENT", "TEACHER", "ADMIN"]);

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/users/[id]
//
// Scope: when the requester is an ADMIN (school principal), the target user
// must have `schoolId === user.schoolId`. 403 otherwise. SUPERADMIN can fetch
// anyone.
export const GET = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const auth = await requireAdminApi();
    if (auth.response) return auth.response;
    const requester = auth.user;

    const { id } = await ctx.params;
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        role: true,
        fullName: true,
        phone: true,
        schoolId: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
        memberships: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            class: { select: { id: true, name: true, gradeLevel: true, section: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (requester.role === "ADMIN") {
      if (!requester.schoolId || user.schoolId !== requester.schoolId) {
        return NextResponse.json(
          { error: "شما فقط کاربران مدرسه خود را می‌توانید مشاهده کنید" },
          { status: 403 },
        );
      }
    }

    return NextResponse.json({ data: user });
  },
);

// PATCH /api/admin/users/[id]  body: { username?, password?, fullName?, role?, phone? }
//
// Scope: when the requester is an ADMIN (school principal), the target user
// must belong to the same school. 403 otherwise. Principals cannot escalate
// a user to ADMIN (only SUPERADMIN can).
export const PATCH = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const auth = await requireAdminApi();
    if (auth.response) return auth.response;
    const requester = auth.user;

    await assertPermission(requester.role, "manage_users");

    const { id } = await ctx.params;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (requester.role === "ADMIN") {
      if (!requester.schoolId || existing.schoolId !== requester.schoolId) {
        return NextResponse.json(
          { error: "شما فقط کاربران مدرسه خود را می‌توانید ویرایش کنید" },
          { status: 403 },
        );
      }
      // Principals cannot escalate a user to ADMIN.
      if (body?.role !== undefined && body.role.toString().toUpperCase() === "ADMIN") {
        return NextResponse.json(
          { error: "فقط مدیر کل می‌تواند مدیر مدرسه ایجاد کند" },
          { status: 403 },
        );
      }
    }

    const data: any = {};

    if (body?.username !== undefined) {
      const username = body.username.toString().trim().toLowerCase();
      if (!username) {
        return NextResponse.json({ error: "username cannot be empty" }, { status: 400 });
      }
      const clash = await db.user.findUnique({ where: { username } });
      if (clash && clash.id !== id) {
        return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      }
      data.username = username;
    }

    if (body?.password !== undefined) {
      const password = body.password.toString();
      if (password.length < 4) {
        return NextResponse.json(
          { error: "password must be at least 4 characters" },
          { status: 400 },
        );
      }
      data.password = await bcrypt.hash(password, 10);
    }

    if (body?.fullName !== undefined) {
      const fullName = body.fullName.toString().trim();
      if (!fullName) {
        return NextResponse.json({ error: "fullName cannot be empty" }, { status: 400 });
      }
      data.fullName = fullName;
    }

    if (body?.role !== undefined) {
      const role = body.role.toString().toUpperCase();
      if (!VALID_ROLES.has(role)) {
        return NextResponse.json(
          { error: "role must be STUDENT, TEACHER, or ADMIN" },
          { status: 400 },
        );
      }
      data.role = role;
    }

    if (body?.phone !== undefined) {
      data.phone = body.phone ? body.phone.toString().trim() : null;
    }

    const updated = await db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        role: true,
        fullName: true,
        phone: true,
        schoolId: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: updated });
  },
);

// DELETE /api/admin/users/[id]
//
// Scope: when the requester is an ADMIN (school principal), the target user
// must belong to the same school. 403 otherwise.
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const auth = await requireAdminApi();
    if (auth.response) return auth.response;
    const requester = auth.user;

    await assertPermission(requester.role, "manage_users");

    const { id } = await ctx.params;

    const existing = await db.user.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (requester.role === "ADMIN") {
      if (!requester.schoolId || existing.schoolId !== requester.schoolId) {
        return NextResponse.json(
          { error: "شما فقط کاربران مدرسه خود را می‌توانید حذف کنید" },
          { status: 403 },
        );
      }
    }

    // AUDIT: user deletion (school-scoped).
    await audit({
      actor: { id: requester.id, username: requester.username, role: requester.role, schoolId: requester.schoolId ?? null },
      action: AuditActions.USER_DELETE,
      targetType: "user",
      targetId: id,
      meta: { deletedUsername: existing?.username ?? null, deletedRole: existing?.role ?? null },
    });

    await db.$transaction([
      db.grade.deleteMany({ where: { createdById: id } }),
      db.behaviorMark.deleteMany({ where: { createdById: id } }),
      db.assignment.deleteMany({ where: { createdById: id } }),
      db.sampleQuestion.deleteMany({ where: { createdById: id } }),
      db.grade.deleteMany({ where: { studentId: id } }),
      db.behaviorMark.deleteMany({ where: { studentId: id } }),
      db.message.deleteMany({ where: { senderId: id } }),
      db.classMembership.deleteMany({ where: { userId: id } }),
      db.user.delete({ where: { id } }),
    ]);

    return NextResponse.json({ data: { success: true, id } });
  },
);
