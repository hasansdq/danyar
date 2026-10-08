import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

const VALID_MEMBER_ROLES = new Set(["STUDENT", "TEACHER"]);

// POST /api/admin/enroll  body: { classId, userIds: string[], role: "STUDENT"|"TEACHER" }
//
// Scope: when the requester is an ADMIN (school principal), the class AND all
// users being enrolled must belong to `user.schoolId`. 403 otherwise.
// SUPERADMIN bypasses the school check.
export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  await assertPermission(user.role, "manage_enrollment");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const classId = (body?.classId || "").toString().trim();
  const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : [];
  const role = (body?.role || "STUDENT").toString().toUpperCase();

  if (!classId) {
    return NextResponse.json({ error: "classId is required" }, { status: 400 });
  }
  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "userIds must be a non-empty array" },
      { status: 400 },
    );
  }
  if (!VALID_MEMBER_ROLES.has(role)) {
    return NextResponse.json(
      { error: "role must be STUDENT or TEACHER" },
      { status: 400 },
    );
  }

  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { id: true, schoolId: true, name: true },
  });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // School-scoped access check for principals.
  if (user.role === "ADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return NextResponse.json(
        { error: "شما فقط می‌توانید در کلاس‌های مدرسه خود ثبت‌نام کنید" },
        { status: 403 },
      );
    }
  }

  // Find which users exist (and are not already members).
  const existingUsers = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, schoolId: true, role: true },
  });
  const existingUserIds = new Set(existingUsers.map((u) => u.id));
  const validUserIds = userIds.filter((id) => existingUserIds.has(id));

  if (validUserIds.length === 0) {
    return NextResponse.json(
      { error: "No valid user IDs provided" },
      { status: 400 },
    );
  }

  // For principals: also verify each user being enrolled is in their school.
  if (user.role === "ADMIN") {
    const outOfSchool = existingUsers.filter(
      (u) => u.schoolId !== user.schoolId,
    );
    if (outOfSchool.length > 0) {
      return NextResponse.json(
        { error: "برخی کاربران به مدرسه شما تعلق ندارند" },
        { status: 403 },
      );
    }
  }

  const existingMemberships = await db.classMembership.findMany({
    where: { classId, userId: { in: validUserIds } },
    select: { userId: true, role: true },
  });
  const existingMap = new Map(
    existingMemberships.map((m) => [m.userId, m.role]),
  );

  const toCreate = validUserIds.filter((id) => !existingMap.has(id));
  const toUpdateRole = validUserIds.filter(
    (id) => existingMap.has(id) && existingMap.get(id) !== role,
  );

  await db.$transaction(async (tx) => {
    for (const userId of toCreate) {
      await tx.classMembership.create({
        data: { classId, userId, role },
      });
    }
    for (const userId of toUpdateRole) {
      await tx.classMembership.update({
        where: { classId_userId: { classId, userId } },
        data: { role },
      });
    }
  });

  return NextResponse.json({
    data: {
      classId,
      role,
      requested: validUserIds.length,
      newlyEnrolled: toCreate.length,
      roleUpdated: toUpdateRole.length,
      alreadyEnrolled:
        validUserIds.length - toCreate.length - toUpdateRole.length,
      invalidUserIds: userIds.filter((id) => !existingUserIds.has(id)),
    },
  });
});

// DELETE /api/admin/enroll  body: { classId, userIds: string[] }
//
// Scope: when the requester is an ADMIN (school principal), the class must
// belong to their school. 403 otherwise. The userIds are not individually
// verified — the only memberships that exist (and therefore get deleted)
// belong to users who are already in the class, which can only happen if
// they were in the same school. SUPERADMIN bypasses the school check.
export const DELETE = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  await assertPermission(user.role, "manage_enrollment");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const classId = (body?.classId || "").toString().trim();
  const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : [];

  if (!classId) {
    return NextResponse.json({ error: "classId is required" }, { status: 400 });
  }
  if (userIds.length === 0) {
    return NextResponse.json(
      { error: "userIds must be a non-empty array" },
      { status: 400 },
    );
  }

  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { id: true, schoolId: true },
  });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  if (user.role === "ADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return NextResponse.json(
        { error: "شما فقط می‌توانید از کلاس‌های مدرسه خود حذف کنید" },
        { status: 403 },
      );
    }
  }

  const result = await db.classMembership.deleteMany({
    where: { classId, userId: { in: userIds } },
  });

  return NextResponse.json({
    data: { classId, removed: result.count },
  });
});
