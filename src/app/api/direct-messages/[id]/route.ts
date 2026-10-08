import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * DELETE /api/direct-messages/[id]
 *
 * Soft-deletes a direct message (sets `deletedAt` + `deletedById`).
 *
 * Permission rules (DMs are simpler than class chats — there's no
 * "teacher-of-class" concept, so we apply the spec literally):
 *   - The SENDER can delete their own message within 12h of `createdAt`.
 *   - The OTHER participant can delete ANY message in their DM at any time.
 *   - SUPERADMIN can delete anytime.
 *   - Idempotent: if already deleted, returns 200 with the existing
 *     deletedBy/deletedAt info.
 *
 * The realtime `direct_message_deleted` socket.io event is emitted by the
 * chat mini-service (Task 2-b style); this REST route only persists state.
 */
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return notFound();

    const message = await db.directMessage.findUnique({
      where: { id },
      select: {
        id: true,
        chatId: true,
        senderId: true,
        createdAt: true,
        deletedAt: true,
        deletedById: true,
      },
    });
    if (!message) {
      return notFound("پیام یافت نشد");
    }

    // Verify the requester is a participant of the message's chat.
    const chat = await db.directChat.findUnique({
      where: { id: message.chatId },
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

    // Idempotent: already deleted → 200 with existing info.
    if (message.deletedAt) {
      return NextResponse.json({
        data: {
          id: message.id,
          deleted: true,
          deletedAt: message.deletedAt.toISOString(),
          deletedById: message.deletedById,
        },
      });
    }

    // Permission:
    //  - SUPERADMIN → anytime.
    //  - Sender of the message → only within 12h.
    //  - The other participant of the chat → anytime.
    const isSender = message.senderId === user.id;
    const isOther =
      (chat.userAId === user.id || chat.userBId === user.id) &&
      !isSender;

    if (user.role !== "SUPERADMIN") {
      if (isSender) {
        const elapsed = Date.now() - message.createdAt.getTime();
        if (elapsed > TWELVE_HOURS_MS) {
          return NextResponse.json(
            {
              error:
                "شما فقط تا ۱۲ ساعت پس از ارسال می‌توانید پیام خود را حذف کنید",
            },
            { status: 403 },
          );
        }
      } else if (!isOther) {
        return NextResponse.json(
          { error: "شما اجازه حذف این پیام را ندارید" },
          { status: 403 },
        );
      }
    }

    const now = new Date();
    const updated = await db.directMessage.update({
      where: { id: message.id },
      data: {
        deletedAt: now,
        deletedById: user.id,
      },
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        chatId: message.chatId,
        deleted: true,
        deletedAt: updated.deletedAt!.toISOString(),
        deletedById: updated.deletedById,
      },
    });
  },
);
