import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/create-class
 * Body JSON: { name, gradeLevel?, section? }
 *
 * Creates a top-level ClassRoom (parentClassId=null) — a class, not a group.
 *
 * Auth:
 *  - ADMIN (principal): schoolId is forced to user.schoolId.
 *  - SUPERADMIN: accepts an optional `schoolId` in the body. When omitted,
 *    the class is created without a school (null schoolId — useful for
 *    platform-wide classes if any).
 *
 * The `name` is globally unique (the existing `ClassRoom.name @unique`
 * constraint); on conflict the route returns 409.
 *
 * Permission gate: "manage_classes" (no-op for SUPERADMIN).
 * Module gate: "bulk_chat" — classes are the chat-management primitive.
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

  let body: {
    name?: unknown;
    gradeLevel?: unknown;
    section?: unknown;
    schoolId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("بدنه درخواست نامعتبر است");
  }

  const name =
    typeof body.name === "string" ? body.name.trim() : "";
  const gradeLevel =
    typeof body.gradeLevel === "string" && body.gradeLevel.trim()
      ? body.gradeLevel.trim()
      : null;
  const section =
    typeof body.section === "string" && body.section.trim()
      ? body.section.trim()
      : null;

  if (!name) {
    return badRequest("نام کلاس الزامی است");
  }

  // Determine schoolId.
  let schoolId: string | null = null;
  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      return NextResponse.json(
        { error: "شما به مدرسه‌ای متصل نیستید" },
        { status: 403 },
      );
    }
    schoolId = user.schoolId;
  } else if (user.role === "SUPERADMIN") {
    if (typeof body.schoolId === "string" && body.schoolId.trim()) {
      const sid = body.schoolId.trim();
      const school = await db.school.findUnique({
        where: { id: sid },
        select: { id: true },
      });
      if (!school) {
        return NextResponse.json(
          { error: "مدرسه مورد نظر یافت نشد" },
          { status: 400 },
        );
      }
      schoolId = sid;
    }
    // else: stay null — a SUPERADMIN can create an unschool'd class.
  }

  // Enforce the global name @unique constraint ourselves for a friendly 409.
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

  const cls = await db.classRoom.create({
    data: {
      name,
      gradeLevel,
      section,
      schoolId,
      parentClassId: null,
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
    },
  });

  return NextResponse.json({ data: cls }, { status: 201 });
});
