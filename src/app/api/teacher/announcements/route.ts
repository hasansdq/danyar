import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/teacher/announcements
 *
 * Lists all announcement messages (isAnnouncement=true) in the classes the
 * caller is authorised to see — for ADMIN (principal) scoped to their
 * school's classes, for SUPERADMIN scoped to all classes, otherwise 403.
 *
 * Each row carries FLAT fields (matching the `AnnouncementRecord` type):
 *   { id, content, createdAt, classId, className, classSection,
 *     senderId, senderFullName, senderRole, senderUsername, senderAvatar,
 *     fileUrl, fileName, fileType, fileSize,
 *     recipientCount, readCount }
 *
 * `recipientCount` = number of members in the target class (so the
 * principal sees "X نفر دریافت کردند"). `readCount` = number of
 * distinct members who have a `MessageRead` row for this message.
 *
 * Sorted by `createdAt` desc. Paginated via `?limit=` (default 50, max 100)
 * and `?cursor=` (ISO date — messages with createdAt < cursor).
 *
 * Auth: ADMIN (principal) or SUPERADMIN only. For ADMIN: scoped to their
 * school. Teachers/students are NOT allowed to enumerate announcements
 * school-wide — they only see announcements inside the classes they're a
 * member of via the normal chat view.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "این بخش فقط برای مدیر / مدیر کل قابل دسترسی است" },
      { status: 403 },
    );
  }

  // Global module gate — announcements are class-chat messages, so we use
  // the class_chat module toggle. SUPERADMIN bypasses.
  await assertModule(user.role, "class_chat");

  // Build the classId scope filter:
  //  - ADMIN (principal): only classes in their school.
  //  - SUPERADMIN: all classes (no filter).
  let classIdFilter: string[] | undefined;
  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      // A principal with no school assigned sees nothing.
      return NextResponse.json({ data: [], hasMore: false, nextCursor: null });
    }
    const schoolClasses = await db.classRoom.findMany({
      where: { schoolId: user.schoolId },
      select: { id: true },
    });
    classIdFilter = schoolClasses.map((c) => c.id);
    if (classIdFilter.length === 0) {
      return NextResponse.json({ data: [], hasMore: false, nextCursor: null });
    }
  }

  // Optional pagination.
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limit = Math.max(1, Math.min(100, Number(limitRaw) || 50));

  let cursorDate: Date | null = null;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "Invalid cursor date" },
        { status: 400 },
      );
    }
    cursorDate = parsed;
  }

  const messages = await db.message.findMany({
    where: {
      isAnnouncement: true,
      deletedAt: null, // exclude soft-deleted announcements
      ...(classIdFilter ? { classId: { in: classIdFilter } } : {}),
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to detect next page
    select: {
      id: true,
      content: true,
      createdAt: true,
      fileUrl: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      sender: {
        select: {
          id: true,
          fullName: true,
          role: true,
          username: true,
          avatar: true,
        },
      },
      class: {
        select: {
          id: true,
          name: true,
          section: true,
        },
      },
    },
  });

  const hasMore = messages.length > limit;
  const sliced = hasMore ? messages.slice(0, limit) : messages;

  // Batch-fetch read counts + member counts for all sliced messages in one
  // round-trip each (avoids N+1). The `class._count.memberships` would be
  // cleaner but Prisma's select above already shaped it for us via the
  // relation aggregation below.
  const messageIds = sliced.map((m) => m.id);

  // Read counts per messageId
  const readAgg = await db.messageRead.groupBy({
    by: ["messageId"],
    where: { messageId: { in: messageIds } },
    _count: { userId: true },
  });
  const readCountMap = new Map<string, number>(
    readAgg.map((r) => [r.messageId, r._count.userId]),
  );

  // Member counts per classId
  const classIds = Array.from(
    new Set(sliced.map((m) => m.class?.id).filter(Boolean) as string[]),
  );
  const memberAgg = await db.classMembership.groupBy({
    by: ["classId"],
    where: { classId: { in: classIds } },
    _count: { userId: true },
  });
  const memberCountMap = new Map<string, number>(
    memberAgg.map((r) => [r.classId, r._count.userId]),
  );

  return NextResponse.json({
    data: sliced.map((m) => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      classId: m.class?.id ?? "",
      className: m.class?.name ?? "",
      classSection: m.class?.section ?? null,
      senderId: m.sender?.id ?? "",
      senderFullName: m.sender?.fullName ?? "",
      senderRole: m.sender?.role ?? "",
      senderUsername: m.sender?.username ?? "",
      senderAvatar: m.sender?.avatar ?? null,
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      recipientCount: m.class?.id ? (memberCountMap.get(m.class.id) ?? 0) : 0,
      readCount: readCountMap.get(m.id) ?? 0,
    })),
    nextCursor:
      hasMore && sliced.length > 0
        ? sliced[sliced.length - 1].createdAt.toISOString()
        : null,
    hasMore,
  });
});
