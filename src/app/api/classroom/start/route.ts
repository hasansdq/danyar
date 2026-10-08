import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * POST /api/classroom/start
 *
 * Body: { classId: string }
 *
 * Starts a new live classroom session for the given class (must be a
 * subject group — parent classes can't host sessions directly). Only
 * TEACHER/ADMIN/SUPERADMIN can start a session. The caller must be a
 * teacher of the class (admins bypass with school-scoping).
 *
 * Returns the created ClassroomSession (with class + startedBy).
 * If a session is already live for the class, returns that one instead
 * (so the teacher can rejoin an active session without creating a
 * duplicate).
 *
 * Generates a unique 6-character room code (uppercase alphanumeric,
 * excluding confusing chars like 0/O, 1/I/L) for shareable join links.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}
async function generateUniqueRoomCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    const existing = await db.classroomSession.findUnique({
      where: { roomCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // Extremely unlikely (20 retries all collided) — append a random suffix.
  return `${generateRoomCode()}${Math.floor(Math.random() * 90 + 10)}`;
}

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const classId = (body?.classId || "").toString().trim();
  if (!classId) return badRequest("classId is required");

  // Authorization: caller must be a teacher of the class (admins bypass
  // with school-scoping, superadmin bypasses entirely).
  const membership = await verifyMembership(user.id, classId);
  const isTeacher = !!membership && membership.role === "TEACHER";
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  if (!isTeacher && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate the class exists.
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: {
      id: true,
      name: true,
      parentClassId: true,
      schoolId: true,
      streamingEnabled: true,
    },
  });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // School-scoping for ADMIN.
  if (user.role === "ADMIN" && cls.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Phase 35b — check the per-group + per-school streaming flags.
  // The per-group flag must be ON (toggled by a teacher via the header icon).
  // The per-school flag must be ON (managed by SUPERADMIN in /superadmin/schools).
  if (!cls.streamingEnabled) {
    return NextResponse.json(
      { error: "استریم برای این گروه فعال نیست. ابتدا توسط معلم فعال شود." },
      { status: 403 },
    );
  }
  if (cls.schoolId) {
    const school = await db.school.findUnique({
      where: { id: cls.schoolId },
      select: { streamingEnabled: true },
    });
    if (school && !school.streamingEnabled) {
      return NextResponse.json(
        { error: "استریم برای این مدرسه توسط مدیر کل غیرفعال شده است." },
        { status: 403 },
      );
    }
  }

  // If there's already a live session for this class, return it (re-join).
  const existing = await db.classroomSession.findFirst({
    where: { classId, status: "live" },
    include: {
      startedBy: {
        select: { id: true, fullName: true, username: true, role: true, avatar: true },
      },
    },
  });
  if (existing) {
    return NextResponse.json({ data: existing });
  }

  // Create a new session with a unique room code.
  const roomCode = await generateUniqueRoomCode();
  const session = await db.classroomSession.create({
    data: {
      classId,
      startedById: user.id,
      roomCode,
      status: "live",
    },
    include: {
      startedBy: {
        select: { id: true, fullName: true, username: true, role: true, avatar: true },
      },
    },
  });

  return NextResponse.json({ data: session }, { status: 201 });
});
