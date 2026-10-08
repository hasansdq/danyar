import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/classroom/[id]/end
 *
 * Ends a live classroom session (sets status="ended" + endedAt=now).
 * Only the session's starter (startedById) or an ADMIN/SUPERADMIN can
 * end it. Verifies the session is currently live.
 *
 * Returns the updated session.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireAuth();
  const { id: sessionId } = await params;

  const session = await db.classroomSession.findUnique({
    where: { id: sessionId },
    select: { id: true, classId: true, startedById: true, status: true, roomCode: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (session.status !== "live") {
    return NextResponse.json({ error: "Session already ended" }, { status: 400 });
  }

  // Authorization: only the starter, an ADMIN of the school, or SUPERADMIN.
  const isStarter = session.startedById === user.id;
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  if (!isStarter && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (user.role === "ADMIN") {
    const cls = await db.classRoom.findUnique({
      where: { id: session.classId },
      select: { schoolId: true },
    });
    if (cls?.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Mark the session as ended + record endedAt.
  const updated = await db.classroomSession.update({
    where: { id: sessionId },
    data: { status: "ended", endedAt: new Date() },
  });

  // Mark any still-active ClassroomParticipant rows as left (in case a
  // user's socket didn't disconnect cleanly).
  await db.classroomParticipant.updateMany({
    where: { sessionId, leftAt: null },
    data: { leftAt: new Date() },
  });

  return NextResponse.json({ data: updated });
});
