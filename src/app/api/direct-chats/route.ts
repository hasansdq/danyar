import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { assertDmPermission } from "@/lib/dm-permissions";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type SessionUser = {
  id: string;
  role: string;
  schoolId?: string | null;
};

/**
 * Given a DirectChat row + the requester id, returns the "other" user
 * (the participant that is NOT the requester) with their public fields.
 */
async function pickOther(
  chat: { userAId: string; userBId: string },
  requesterId: string,
) {
  const otherId = chat.userAId === requesterId ? chat.userBId : chat.userAId;
  return db.user.findUnique({
    where: { id: otherId },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      avatar: true,
    },
  });
}

/**
 * GET /api/direct-chats
 *
 * Lists the requester's direct chats. For each: the other user
 * `{ id, fullName, username, role, avatar }`, `lastMessage`
 *   `{ id, content, createdAt, senderId, isRead } | null`,
 * and `unreadCount` (messages from the other user with `readAt IS NULL`).
 *
 * - `unreadCount` is the number of messages in this chat whose sender is NOT
 *   the requester and whose `readAt` is still NULL (unread, sent by the other
 *   participant). The frontend renders it as a Telegram-style badge on the row.
 * - `lastMessage.isRead` is `readAt !== null` for the latest message — when
 *   the requester sent that message, this lets the sender's UI show blue ticks
 *   (single ✓ = delivered, double ✓✓ = read).
 *
 * Sort: `lastMessageAt desc`.
 */
export const GET = apiHandler(async (_req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "direct_chat");

  const chats = await db.directChat.findMany({
    where: {
      OR: [{ userAId: user.id }, { userBId: user.id }],
    },
    orderBy: { lastMessageAt: "desc" },
    include: {
      // Latest non-deleted message (one row). Includes `readAt` so the
      // sender can render read-receipt ticks.
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          content: true,
          createdAt: true,
          senderId: true,
          readAt: true,
        },
      },
      // Count of messages FROM THE OTHER USER that are still unread
      // (readAt IS NULL, not soft-deleted). Prisma supports filtered
      // relation counts via `_count.select.<rel>.where`.
      _count: {
        select: {
          messages: {
            where: {
              senderId: { not: user.id },
              readAt: null,
              deletedAt: null,
            },
          },
        },
      },
    },
  });

  // Batch-load the "other" user for each chat in one go to avoid N+1.
  const otherIds = chats.map((c) =>
    c.userAId === user.id ? c.userBId : c.userAId,
  );
  const others = await db.user.findMany({
    where: { id: { in: otherIds } },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      avatar: true,
    },
  });
  const otherMap = new Map(others.map((o) => [o.id, o]));

  return NextResponse.json({
    data: chats.map((c) => {
      const otherId = c.userAId === user.id ? c.userBId : c.userAId;
      const other = otherMap.get(otherId) ?? null;
      const last = c.messages[0] ?? null;
      return {
        id: c.id,
        schoolId: c.schoolId,
        createdAt: c.createdAt.toISOString(),
        lastMessageAt: c.lastMessageAt.toISOString(),
        otherUser: other,
        lastMessage: last
          ? {
              id: last.id,
              content: last.content,
              createdAt: last.createdAt.toISOString(),
              senderId: last.senderId,
              // true when the recipient has opened the chat (readAt set).
              // For the SENDER's last message, this drives blue ticks.
              isRead: last.readAt !== null,
            }
          : null,
        unreadCount: c._count.messages,
      };
    }),
  });
});

/**
 * POST /api/direct-chats
 *
 * Body: `{ userId }` — start (or get) a direct chat with the target user.
 *
 * Steps:
 *   1. Load the target user (404 if not found).
 *   2. Check DM permission via `assertDmPermission(requester, target)`.
 *   3. Compute the canonical pair (userAId < userBId by string sort).
 *   4. Upsert a DirectChat row (unique [userAId, userBId]) with schoolId
 *      from the permission check.
 *   5. Return the chat with the other user's info.
 *
 * Returns: `{ data: { id, schoolId, createdAt, lastMessageAt, otherUser } }`.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth() as SessionUser & { id: string };

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "direct_chat");

  let body: { userId?: unknown };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const targetId = typeof body?.userId === "string" ? body.userId : "";
  if (!targetId) return badRequest("userId الزامی است");
  if (targetId === user.id) {
    return badRequest("شما نمی‌توانید با خودتان چت خصوصی شروع کنید");
  }

  const target = await db.user.findUnique({
    where: { id: targetId },
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      avatar: true,
      schoolId: true,
    },
  });
  if (!target) return notFound("کاربر یافت نشد");

  // Check DM permission. Throws DmPermissionDeniedError → 403 via apiHandler.
  const sharedSchoolId = await assertDmPermission(
    user.role,
    user.schoolId,
    target.role,
    target.schoolId,
  );

  // Canonical pair: userAId < userBId by string sort (cuids are sortable
  // lexicographically).
  const [userAId, userBId] =
    user.id < target.id ? [user.id, target.id] : [target.id, user.id];

  const chat = await db.directChat.upsert({
    where: { userAId_userBId: { userAId, userBId } },
    update: {
      // Refresh the schoolId in case the school changed (rare, but cheap).
      schoolId: sharedSchoolId,
    },
    create: {
      userAId,
      userBId,
      schoolId: sharedSchoolId,
    },
    select: {
      id: true,
      schoolId: true,
      createdAt: true,
      lastMessageAt: true,
    },
  });

  return NextResponse.json({
    data: {
      id: chat.id,
      schoolId: chat.schoolId,
      createdAt: chat.createdAt.toISOString(),
      lastMessageAt: chat.lastMessageAt.toISOString(),
      otherUser: {
        id: target.id,
        fullName: target.fullName,
        username: target.username,
        role: target.role,
        avatar: target.avatar,
      },
    },
  });
});
