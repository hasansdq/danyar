import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/create-group
 * Body JSON: { parentClassId, name }
 *
 * Creates a ClassRoom with `parentClassId` set — a "group" (chat) within the
 * parent class. The `name` must be globally unique (the existing
 * `ClassRoom.name @unique` constraint); on conflict the route returns 409.
 *
 * The frontend typically constructs the name as
 *   "parentClass.name — groupName"
 * to keep names unique across parent classes that share group names.
 *
 * Auth:
 *  - ADMIN (principal): the parent class MUST belong to the principal's
 *    school. schoolId is auto-set from the parent class.
 *  - SUPERADMIN: any parent class.
 *
 * Auto-enroll: the principal (the ADMIN user calling this route) is enrolled
 * as a TEACHER member of the new group so they can manage it. SUPERADMIN is
 * also enrolled as TEACHER (the same way) so they can manage the group too.
 *
 * Permission gate: "manage_classes" (no-op for SUPERADMIN).
 * Module gate: "bulk_chat" — groups inherit the bulk_chat module since they
 * are chat-management primitives.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "این بخش فقط برای مدیر مدرسه در دسترس است" },
      { status: 403 },
    );
  }

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "bulk_chat");
  await assertPermission(user.role, "manage_classes");

  let body: { parentClassId?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("بدنه درخواست نامعتبر است");
  }

  const parentClassId =
    typeof body.parentClassId === "string" ? body.parentClassId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!parentClassId) {
    return badRequest("شناسه کلاس والد الزامی است");
  }
  if (!name) {
    return badRequest("نام گروه الزامی است");
  }

  // Load the parent class.
  const parent = await db.classRoom.findUnique({
    where: { id: parentClassId },
    select: { id: true, name: true, schoolId: true, parentClassId: true },
  });
  if (!parent) {
    return NextResponse.json(
      { error: "کلاس والد یافت نشد" },
      { status: 404 },
    );
  }

  // The parent class must itself be a top-level class (parentClassId=null).
  // A group can't have sub-groups.
  if (parent.parentClassId !== null) {
    return NextResponse.json(
      { error: "کلاس والد خود یک گروه است — نمی‌توان گروه زیرمجموعه‌ای ساخت" },
      { status: 400 },
    );
  }

  // School scoping.
  let schoolId: string | null = parent.schoolId ?? null;
  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      return NextResponse.json(
        { error: "شما به مدرسه‌ای متصل نیستید" },
        { status: 403 },
      );
    }
    if (parent.schoolId !== user.schoolId) {
      return NextResponse.json(
        { error: "این کلاس در مدرسه شما نیست" },
        { status: 403 },
      );
    }
    schoolId = user.schoolId;
  }
  // SUPERADMIN: keep the parent class's schoolId (which may be null for an
  // unscoped class — that's allowed at the SUPERADMIN level).

  // Enforce the global name @unique constraint ourselves so we return a
  // friendly 409 instead of bubbling up a Prisma P2002.
  const existing = await db.classRoom.findUnique({
    where: { name },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "کلاسی با این نام از قبل وجود دارد" },
      { status: 409 },
    );
  }

  // Create the group + auto-enroll the principal as TEACHER + (Phase 25)
  // auto-enroll ALL students already in the parent class into the new
  // subject group — so when a principal creates a new subject group for
  // an existing class, every student in that class is immediately in the
  // new chat room without the principal having to add them one-by-one.
  // The whole flow runs inside a single $transaction for atomicity.
  const created = await db.$transaction(async (tx) => {
    const group = await tx.classRoom.create({
      data: {
        name,
        schoolId,
        parentClassId: parent.id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        gradeLevel: true,
        section: true,
        schoolId: true,
        parentClassId: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
        parentClass: { select: { id: true, name: true } },
      },
    });

    // 1. Auto-enroll the principal (the ADMIN user calling this route) as
    //    TEACHER so they can manage + post in the new subject group.
    await tx.classMembership.upsert({
      where: {
        classId_userId: { classId: group.id, userId: user.id },
      },
      update: { role: "TEACHER" },
      create: {
        classId: group.id,
        userId: user.id,
        role: "TEACHER",
      },
    });

    // 2. Phase 25 — find every STUDENT already enrolled in the parent
    //    class (membership.role = "STUDENT" on the parent class) and add
    //    them to the new subject group with role="STUDENT". skipDuplicates
    //    is a defensive no-op (the group was just created so no
    //    memberships exist yet, but it's cheap insurance).
    const parentStudentIds = await tx.classMembership.findMany({
      where: { classId: parent.id, role: "STUDENT" },
      select: { userId: true },
    });
    if (parentStudentIds.length > 0) {
      await tx.classMembership.createMany({
        data: parentStudentIds.map((m) => ({
          classId: group.id,
          userId: m.userId,
          role: "STUDENT",
        })),
      });
    }

    return group;
  });

  return NextResponse.json({ data: created }, { status: 201 });
});
