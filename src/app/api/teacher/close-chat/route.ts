import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/close-chat
 * Body JSON: { classId }
 *
 * Closes the chat for the class so STUDENTS can no longer send messages.
 * Teachers and admins can still send.
 *
 * Authorization: TEACHER of the class OR ADMIN.
 * Permission gate: "close_chat" (no-op for SUPERADMIN).
 *
 * Note: this route ONLY persists state. The socket.io service (Task 2-b)
 * emits the `chat_closed` realtime event to the room.
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
  // SECURITY (school scoping): an ADMIN (principal) may only close chats of
  // classes in their OWN school. SUPERADMIN stays unscoped.
  if (!teacherOf && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  const cls = await db.classRoom.findUnique({ where: { id: classId } });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  const now = new Date();
  await db.classRoom.update({
    where: { id: classId },
    data: {
      chatClosed: true,
      chatClosedAt: now,
      chatClosedById: user.id,
    },
  });

  return NextResponse.json({
    data: {
      classId,
      chatClosed: true,
      chatClosedAt: now.toISOString(),
      chatClosedById: user.id,
    },
  });
});
