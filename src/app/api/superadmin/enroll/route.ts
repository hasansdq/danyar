import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const VALID_MEMBER_ROLES = new Set(["STUDENT", "TEACHER"]);

/**
 * POST /api/superadmin/enroll
 * Body: { classId, userIds: string[], role: "STUDENT"|"TEACHER" }
 *
 * Batch enroll users into a class. For users already members, update their
 * role if it differs. Returns breakdown.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

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

  const cls = await db.classRoom.findUnique({ where: { id: classId } });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const existingUsers = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true },
  });
  const existingUserIds = new Set(existingUsers.map((u) => u.id));
  const validUserIds = userIds.filter((id) => existingUserIds.has(id));

  if (validUserIds.length === 0) {
    return NextResponse.json(
      { error: "No valid user IDs provided" },
      { status: 400 },
    );
  }

  const existingMemberships = await db.classMembership.findMany({
    where: { classId, userId: { in: validUserIds } },
    select: { userId: true, role: true },
  });
  const existingMap = new Map(existingMemberships.map((m) => [m.userId, m.role]));

  const toCreate = validUserIds.filter((id) => !existingMap.has(id));
  const toUpdateRole = validUserIds.filter(
    (id) => existingMap.has(id) && existingMap.get(id) !== role,
  );

  await db.$transaction(async (tx) => {
    for (const userId of toCreate) {
      await tx.classMembership.create({ data: { classId, userId, role } });
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
}

/**
 * DELETE /api/superadmin/enroll
 * Body: { classId, userIds: string[] }
 * Batch remove memberships.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

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

  const result = await db.classMembership.deleteMany({
    where: { classId, userId: { in: userIds } },
  });

  return NextResponse.json({
    data: { classId, removed: result.count },
  });
}
