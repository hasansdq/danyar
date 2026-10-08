import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/open-chat
 * Body JSON: { classId }
 *
 * Re-opens a previously closed chat so STUDENTS can send messages again.
 *
 * Authorization: TEACHER of the class OR ADMIN.
 * Permission gate: "close_chat" (no-op for SUPERADMIN).
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();
  await assertPermission(user.role, "close_chat");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const classId: string | undefined = body?.classId;
  if (!classId) return badRequest("classId is required");

  // Authorization: teacher of the class OR admin.
  const teacherOf = await isTeacherOf(user.id, classId);
  if (!teacherOf && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // SECURITY (school scoping): an ADMIN (principal) may only re-open chats
  // of classes in their OWN school. SUPERADMIN stays unscoped.
  if (!teacherOf && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  const cls = await db.classRoom.findUnique({ where: { id: classId } });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  await db.classRoom.update({
    where: { id: classId },
    data: {
      chatClosed: false,
      chatClosedAt: null,
      chatClosedById: null,
    },
  });

  return NextResponse.json({
    data: {
      classId,
      chatClosed: false,
      chatClosedAt: null,
      chatClosedById: null,
    },
  });
});
