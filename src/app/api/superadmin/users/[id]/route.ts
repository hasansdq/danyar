import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import { checkPasswordPolicy } from "@/lib/password-policy";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["STUDENT", "TEACHER", "ADMIN", "SUPERADMIN"]);

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/superadmin/users/[id]
 * Returns the user (no password) with all memberships.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      role: true,
      fullName: true,
      phone: true,
      avatar: true,
      schoolId: true,
      createdAt: true,
      updatedAt: true,
      school: { select: { id: true, name: true } },
      memberships: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          class: {
            select: { id: true, name: true, gradeLevel: true, section: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ data: user });
}

/**
 * PATCH /api/superadmin/users/[id]
 * Body: { username?, password?, fullName?, role?, phone?, schoolId? }
 * If password is provided, it is hashed with bcrypt.
 * If schoolId is provided (string|null), validates it references a real School
 * (null = un-affiliate the user from any school). SUPERADMIN users cannot be
 * assigned to a school.
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

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const data: any = {};

  if (body?.username !== undefined) {
    const username = body.username.toString().trim().toLowerCase();
    if (!username) {
      return NextResponse.json(
        { error: "username cannot be empty" },
        { status: 400 },
      );
    }
    const clash = await db.user.findUnique({ where: { username } });
    if (clash && clash.id !== id) {
      return NextResponse.json(
        { error: "Username already taken" },
        { status: 409 },
      );
    }
    data.username = username;
  }

  if (body?.password !== undefined) {
    const password = body.password.toString();
    // SECURITY: server-side password policy.
    const policy = checkPasswordPolicy(password, { username: existing.username });
    if (!policy.ok) {
      return NextResponse.json({ error: policy.reason }, { status: 400 });
    }
    data.password = await bcrypt.hash(password, 10);
  }

  if (body?.fullName !== undefined) {
    const fullName = body.fullName.toString().trim();
    if (!fullName) {
      return NextResponse.json(
        { error: "fullName cannot be empty" },
        { status: 400 },
      );
    }
    data.fullName = fullName;
  }

  if (body?.role !== undefined) {
    const role = body.role.toString().toUpperCase();
    if (!VALID_ROLES.has(role)) {
      return NextResponse.json(
        {
          error: "role must be STUDENT, TEACHER, ADMIN, or SUPERADMIN",
        },
        { status: 400 },
      );
    }
    data.role = role;
  }

  if (body?.phone !== undefined) {
    data.phone = body.phone ? body.phone.toString().trim() : null;
  }

  if (body?.schoolId !== undefined) {
    const schoolIdRaw = body.schoolId
      ? body.schoolId.toString().trim()
      : null;
    // Phase 23: schoolId can only be null for SUPERADMIN
    // Phase 36g fix: use `id` (already-awaited from params Promise), NOT
    // `params.id` (params is a Promise — params.id is undefined → 500).
    const targetUser = await db.user.findUnique({ where: { id }, select: { role: true } });
    if (!schoolIdRaw && targetUser && targetUser.role !== "SUPERADMIN") {
      return NextResponse.json(
        { error: "انتخاب مدرسه برای این کاربر الزامی است" },
        { status: 400 },
      );
    }
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
      // null only allowed for SUPERADMIN
      data.schoolId = null;
    }
  }

  // If the role is being changed to SUPERADMIN, drop school affiliation.
  if (data.role === "SUPERADMIN") {
    data.schoolId = null;
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
      avatar: true,
      schoolId: true,
      createdAt: true,
      updatedAt: true,
      school: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: updated });
}

/**
 * DELETE /api/superadmin/users/[id]
 * Prevents self-deletion (returns 400 if req user id === params id).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  const { id } = await params;

  if (id === user.id) {
    return NextResponse.json(
      { error: "شما نمی‌توانید حساب خود را حذف کنید" },
      { status: 400 },
    );
  }

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // AUDIT: user deletion (cascades inside the transaction below).
  await audit({
    actor: { id: user.id, username: user.username, role: user.role, schoolId: user.schoolId ?? null },
    action: AuditActions.USER_DELETE,
    targetType: "user",
    targetId: id,
    req,
    meta: { deletedUsername: existing.username, deletedRole: existing.role },
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
}
