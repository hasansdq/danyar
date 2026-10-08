import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/direct-chats/[id]/read
 *
 * Called when the user opens (or scrolls to the bottom of) a direct chat.
 * Marks as read every message in this chat whose `senderId` is NOT the
 * requester's AND whose `readAt` is still NULL (i.e. unread messages from
 * the other participant).
 *
 * Permission: the requester must be a participant of the DirectChat
 * (userAId or userBId). SUPERADMIN bypasses (moderation).
 *
 * Returns: `{ data: { chatId, markedRead: <count> } }` — `markedRead` is the
 * number of rows actually updated (0 if there were no unread messages).
 *
 * The matching `direct_messages_read` socket.io broadcast is emitted by the
 * chat mini-service when the client emits `mark_direct_read { chatId }` —
 * this REST route only persists state. The frontend typically uses the socket
 * event (lower latency) and may also call this REST endpoint as a fallback on
 * initial chat open.
 */
export const POST = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id: chatId } = await ctx.params;
    if (!chatId) return notFound("chatId الزامی است");

    // Verify the requester is a participant of this DirectChat.
    const chat = await db.directChat.findUnique({
      where: { id: chatId },
      select: { id: true, userAId: true, userBId: true },
    });
    if (!chat) {
      return notFound("گفتگو یافت نشد");
    }
    const isParticipant =
      chat.userAId === user.id || chat.userBId === user.id;
    if (!isParticipant && user.role !== "SUPERADMIN") {
      return NextResponse.json(
        { error: "دسترسی به این گفتگو مجاز نیست" },
        { status: 403 },
      );
    }

    // Mark all unread messages FROM THE OTHER USER as read.
    // (We never mark our OWN messages — `readAt` is set when the RECIPIENT
    // opens the chat, and that's the OTHER participant's perspective, so
    // for this caller the "other user's messages" are the ones they need to
    // mark read.)
    const now = new Date();
    const result = await db.directMessage.updateMany({
      where: {
        chatId,
        senderId: { not: user.id },
        readAt: null,
        // Only touch non-deleted messages — a soft-deleted row shouldn't
        // surface as "newly read" (it's already hidden from both sides).
        deletedAt: null,
      },
      data: { readAt: now },
    });

    return NextResponse.json({
      data: {
        chatId,
        markedRead: result.count,
      },
    });
  },
);
