import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/messages/saved
 *
 * Returns all messages the current user has saved (bookmarked). Each row is
 * a MessageSaved → Message → sender + class join, so the UI can render the
 * "saved messages" sheet without additional round trips.
 *
 * Auth: any logged-in user. (The save endpoint already enforced that the
 * user was a member of the message's class when they saved it; we don't
 * re-check here — if the user was removed from the class, the saved row
 * stays (it's their personal bookmark) but the underlying message may be
 * gone (cascade-deleted with the class). We filter out orphaned saves
 * (Prisma's onDelete: Cascade handles the deletion; if any orphans slip
 * through, they're filtered by the inner join on `message`).
 *
 * Returns: `{ data: [{ id, content, createdAt, sender: {id, fullName, role},
 * class: {id, name}, fileUrl, fileName, fileType }] }` sorted by
 * `savedAt` desc (most-recently-saved first).
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Optional pagination — `?limit=` and `?cursor=` (savedAt ISO date).
  // Default limit 50, max 100.
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

  const saves = await db.messageSaved.findMany({
    where: {
      userId: user.id,
      ...(cursorDate ? { savedAt: { lt: cursorDate } } : {}),
    },
    orderBy: { savedAt: "desc" },
    take: limit + 1, // fetch one extra to detect next page
    select: {
      id: true,
      savedAt: true,
      message: {
        select: {
          id: true,
          content: true,
          createdAt: true,
          deletedAt: true,
          fileUrl: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          mimeType: true,
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
            },
          },
        },
      },
    },
  });

  // Filter out saves whose message was cascade-deleted (defence in depth —
  // the FK cascade should already have removed these rows).
  const valid = saves.filter((s) => s.message !== null);
  const hasMore = valid.length > limit;
  const sliced = hasMore ? valid.slice(0, limit) : valid;

  return NextResponse.json({
    data: sliced.map((s) => ({
      id: s.message.id,
      content: s.message.content,
      createdAt: s.message.createdAt.toISOString(),
      savedAt: s.savedAt.toISOString(),
      sender: {
        id: s.message.sender.id,
        fullName: s.message.sender.fullName,
        role: s.message.sender.role,
        username: s.message.sender.username,
        avatar: s.message.sender.avatar,
      },
      class: {
        id: s.message.class.id,
        name: s.message.class.name,
      },
      fileUrl: s.message.fileUrl,
      fileName: s.message.fileName,
      fileType: s.message.fileType,
      fileSize: s.message.fileSize,
      mimeType: s.message.mimeType,
      isDeleted: !!s.message.deletedAt,
    })),
    nextCursor:
      hasMore && sliced.length > 0
        ? sliced[sliced.length - 1].savedAt.toISOString()
        : null,
    hasMore,
  });
});
