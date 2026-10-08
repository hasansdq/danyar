import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/classroom/join?code=<roomCode>
 *
 * Looks up a live ClassroomSession by its 6-character room code (the
 * shareable join link). Returns the session + the class info so the
 * frontend can render the class name + the joiner can confirm before
 * joining the WebRTC room.
 *
 * Does NOT auto-join the user to the WebRTC room — that's done via the
 * socket.io `join_session` event after this lookup. The endpoint just
 * verifies the code is valid + the session is live.
 *
 * Response shape:
 *   { data: { id, classId, roomCode, status, startedAt, startedBy, class: { id, name, section } } | null }
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase();
  if (!code) return badRequest("code is required");

  const session = await db.classroomSession.findUnique({
    where: { roomCode: code },
    include: {
      startedBy: {
        select: { id: true, fullName: true, username: true, role: true, avatar: true },
      },
      class: {
        select: { id: true, name: true, section: true, schoolId: true },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ data: null });
  }
  if (session.status !== "live") {
    return NextResponse.json({
      data: { ...session, status: "ended" },
    });
  }

  // School-scoping for ADMIN: the session's class must be in their school.
  if (user.role === "ADMIN" && session.class.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ data: session });
});
