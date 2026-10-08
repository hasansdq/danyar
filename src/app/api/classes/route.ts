import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/classes
 *
 * Returns the classes the calling user can see + chat in.
 *
 *  - STUDENT / TEACHER: the classes they have a ClassMembership row in
 *    (with the membership role + memberCount + latestMessage preview).
 *  - ADMIN (school principal): ALL classes in their school, regardless of
 *    whether they have a ClassMembership row. The synthetic role returned
 *    is "ADMIN" so the messenger UI grants the principal moderator access
 *    AND can show a "مدیر" badge distinct from a teacher.
 *  - SUPERADMIN: every class in the system (also synthetic role "ADMIN").
 *
 * Each row carries: id, name, description, gradeLevel, section, chatClosed
 * + chatClosedAt + chatClosedById, fileUploadEnabled + maxFileSizeMb +
 * allowedFileTypes (parsed array|null), createdAt, role, memberCount,
 * latestMessage preview (content + createdAt + sender including `avatar`).
 */
export const GET = apiHandler(async () => {
  const user = await requireAuth();

  // Build the candidate (classId, role) rows. For STUDENT/TEACHER these are
  // the user's actual ClassMembership rows. For ADMIN we synthesize rows for
  // every class in their school (or every class for SUPERADMIN), and any
  // real ClassMembership rows the principal happens to have are folded in
  // (the explicit TEACHER/STUDENT membership wins over the synthetic one
  // so the messenger UI shows the right badge).
  type Candidate = { classId: string; role: "STUDENT" | "TEACHER" | "ADMIN" };

  const explicitMemberships = await db.classMembership.findMany({
    where: { userId: user.id },
    select: { classId: true, role: true },
  });
  const explicitByClass = new Map<string, "STUDENT" | "TEACHER" | "ADMIN">();
  for (const m of explicitMemberships) {
    if (m.role === "STUDENT" || m.role === "TEACHER") {
      explicitByClass.set(m.classId, m.role);
    }
  }

  const candidates: Candidate[] = explicitMemberships
    .filter((m): m is { classId: string; role: "STUDENT" | "TEACHER" } =>
      m.role === "STUDENT" || m.role === "TEACHER",
    )
    .map((m) => ({ classId: m.classId, role: m.role }));

  if (user.role === "ADMIN") {
    if (user.schoolId) {
      const schoolClasses = await db.classRoom.findMany({
        where: { schoolId: user.schoolId },
        select: { id: true },
      });
      for (const c of schoolClasses) {
        if (!explicitByClass.has(c.id)) {
          candidates.push({ classId: c.id, role: "ADMIN" });
        }
      }
    }
  } else if (user.role === "SUPERADMIN") {
    const allClasses = await db.classRoom.findMany({ select: { id: true } });
    for (const c of allClasses) {
      if (!explicitByClass.has(c.id)) {
        candidates.push({ classId: c.id, role: "ADMIN" });
      }
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const classIds = candidates.map((c) => c.classId);

  // Load the class definitions in one query.
  const classes = await db.classRoom.findMany({
    where: { id: { in: classIds } },
  });
  const classById = new Map(classes.map((c) => [c.id, c]));

  // Aggregate member counts per class in one query.
  const memberCountRows = await db.classMembership.groupBy({
    by: ["classId"],
    where: { classId: { in: classIds } },
    _count: { userId: true },
  });
  const memberCountMap = new Map<string, number>(
    memberCountRows.map((r) => [r.classId, r._count.userId]),
  );

  // Aggregate TEACHER counts per class (role=TEACHER memberships).
  const teacherCountRows = await db.classMembership.groupBy({
    by: ["classId"],
    where: { classId: { in: classIds }, role: "TEACHER" },
    _count: { userId: true },
  });
  const teacherCountMap = new Map<string, number>(
    teacherCountRows.map((r) => [r.classId, r._count.userId]),
  );

  // Phase 36j — fetch all active (live) ClassroomSessions for the user's
  // classes. This powers the "کلاس ویدئویی فعال" (active video class) icon
  // on the conversation list — when a teacher starts a stream, an icon
  // appears on that group's row for all roles.
  const activeSessions = await db.classroomSession.findMany({
    where: { classId: { in: classIds }, status: "live" },
    select: { classId: true },
  });
  const activeStreamClassIds = new Set(activeSessions.map((s) => s.classId));

  // Sort by class name ascending (Persian locale).
  const sorted = [...candidates].sort((a, b) => {
    const ca = classById.get(a.classId);
    const cb = classById.get(b.classId);
    if (!ca) return 1;
    if (!cb) return -1;
    return ca.name.localeCompare(cb.name, "fa");
  });

  // Fetch the most recent message per class. SQLite doesn't support
  // `DISTINCT ON`, but a per-class `take: 1` lookup is cheap on messenger
  // scale and keeps the result set small. Exclude soft-deleted messages.
  const latestByClass = new Map<
    string,
    {
      content: string;
      createdAt: string;
      sender: {
        id: string;
        fullName: string;
        username: string;
        role: string;
        avatar: string | null;
      };
    }
  >();
  for (const c of sorted) {
    const msg = await db.message.findFirst({
      where: { classId: c.classId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            username: true,
            role: true,
            avatar: true,
          },
        },
      },
    });
    if (msg) {
      latestByClass.set(c.classId, {
        content: msg.content,
        createdAt: msg.createdAt.toISOString(),
        sender: {
          id: msg.sender.id,
          fullName: msg.sender.fullName,
          username: msg.sender.username,
          role: msg.sender.role,
          avatar: msg.sender.avatar,
        },
      });
    }
  }

  // Parse the per-class allowed-file-types JSON (if present) into an array.
  // null/empty → null = "all types allowed".
  function parseAllowedTypes(raw: string | null): string[] | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(
          (x): x is string => typeof x === "string",
        );
        return filtered.length > 0 ? filtered : null;
      }
    } catch {
      // ignore malformed JSON
    }
    return null;
  }

  // Phase 35b — fetch the user's school's streamingEnabled flag. When
  // false, streaming is fully disabled in the school — the FAB + header
  // toggle are hidden from all groups. SUPERADMIN has no school, so the
  // flag defaults to true (they can access any school's classes).
  let schoolStreamingEnabled = true;
  if (user.schoolId) {
    const school = await db.school.findUnique({
      where: { id: user.schoolId },
      select: { streamingEnabled: true },
    });
    schoolStreamingEnabled = school?.streamingEnabled ?? true;
  }

  const data = sorted
    .map((c) => {
      const cls = classById.get(c.classId);
      if (!cls) return null;
      return {
        id: cls.id,
        name: cls.name,
        description: cls.description,
        gradeLevel: cls.gradeLevel,
        section: cls.section,
        // When parentClassId is set, this ClassRoom is a "group" (chat) inside
        // the parent class. Frontend uses this to render the hierarchy.
        parentClassId: cls.parentClassId ?? null,
        // Group profile picture (phase 18). null = no avatar — the frontend
        // falls back to the ChatAvatar initials bubble.
        avatar: cls.avatar,
        chatClosed: cls.chatClosed,
        chatClosedAt: cls.chatClosedAt
          ? cls.chatClosedAt.toISOString()
          : null,
        chatClosedById: cls.chatClosedById,
        fileUploadEnabled: cls.fileUploadEnabled,
        maxFileSizeMb: cls.maxFileSizeMb,
        allowedFileTypes: parseAllowedTypes(cls.allowedFileTypes),
        // Phase 35b — per-group streaming flag. The frontend uses this +
        // the school's streaming flag to decide whether to show the FAB +
        // the header toggle icon.
        streamingEnabled: cls.streamingEnabled,
        // Phase 35b — per-school streaming flag. Included on every class
        // item for convenience (it's the same for all classes of the same
        // school). When false, streaming is fully disabled in the school.
        schoolStreamingEnabled,
        // Phase 36j — true when there's an active (live) ClassroomSession
        // for this class. The conversation list shows a "کلاس ویدئویی
        // فعال" icon on rows where this is true.
        streamingActive: activeStreamClassIds.has(cls.id),
        createdAt: cls.createdAt.toISOString(),
        role: c.role,
        memberCount: memberCountMap.get(cls.id) ?? 0,
        teacherCount: teacherCountMap.get(cls.id) ?? 0,
        latestMessage: latestByClass.get(c.classId) ?? null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ data });
});
