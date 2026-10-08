import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/messages/[id]/save
 *
 * Saves (bookmarks) the message identified by [id] for the current user by
 * creating a MessageSaved row. Idempotent: if a MessageSaved row already
 * exists for this (messageId, userId) pair (the unique constraint), the
 * upsert is a no-op.
 *
 * Auth: the requester must be a member of the message's class — OR a
 * principal (ADMIN) of the school that owns the class — OR a SUPERADMIN.
 * Saves are personal (each user has their own save list), but only members
 * of the class the message lives in are allowed to save it (otherwise a
 * user could bookmark messages in classes they don't have access to).
 *
 * Returns `{ data: { saved: true } }`.
 */
export const POST = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    await assertModule(user.role, "class_chat");
    const { id } = await ctx.params;
    if (!id) return notFound("شناسه پیام الزامی است");

    // Load the message so we know which class it belongs to.
    const message = await db.message.findUnique({
      where: { id },
      select: { id: true, classId: true, deletedAt: true },
    });
    if (!message) {
      return notFound("پیام یافت نشد");
    }
    // Don't allow saving a soft-deleted message — defence in depth (the UI
    // hides it anyway).
    if (message.deletedAt) {
      return NextResponse.json(
        { error: "این پیام حذف شده و قابل ذخیره نیست" },
        { status: 400 },
      );
    }

    // Access control: member OR principal of the school OR SUPERADMIN.
    const membership = await verifyMembership(user.id, message.classId);
    const cls = await db.classRoom.findUnique({
      where: { id: message.classId },
      select: { schoolId: true },
    });
    const isPrincipalOfClass =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      cls?.schoolId === user.schoolId;
    const isSuperAdmin = user.role === "SUPERADMIN";

    if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Upsert the MessageSaved row. The unique [messageId, userId] constraint
    // means calling this endpoint twice for the same message is a no-op.
    await db.messageSaved.upsert({
      where: {
        messageId_userId: { messageId: id, userId: user.id },
      },
      update: {}, // no fields to update — the row already exists
      create: {
        messageId: id,
        userId: user.id,
      },
    });

    return NextResponse.json({ data: { saved: true } });
  },
);

/**
 * DELETE /api/messages/[id]/save
 *
 * Removes the MessageSaved row for this (messageId, userId) pair — i.e.
 * un-saves / un-bookmarks the message. Idempotent: deleting a non-existent
 * row is a no-op (returns `{ data: { saved: false } }`).
 *
 * Auth: same as POST — member OR principal of the school OR SUPERADMIN. We
 * re-check membership because the un-save flow should not be a way to
 * detect that a message exists in a class you don't have access to.
 */
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    await assertModule(user.role, "class_chat");
    const { id } = await ctx.params;
    if (!id) return notFound("شناسه پیام الزامی است");

    // Load the message so we can verify the requester is a member of the
    // message's class. We don't return 404 if the message is gone (a user
    // might want to clear a stale save after the message was hard-deleted
    // by cascade) — we instead just delete any MessageSaved row matching
    // the (messageId, userId) pair.
    const message = await db.message.findUnique({
      where: { id },
      select: { id: true, classId: true },
    });
    if (message) {
      const membership = await verifyMembership(user.id, message.classId);
      const cls = await db.classRoom.findUnique({
        where: { id: message.classId },
        select: { schoolId: true },
      });
      const isPrincipalOfClass =
        user.role === "ADMIN" &&
        !!user.schoolId &&
        cls?.schoolId === user.schoolId;
      const isSuperAdmin = user.role === "SUPERADMIN";

      if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    // If the message no longer exists, allow the un-save to proceed (the
    // MessageSaved row would have been cascade-deleted with the message,
    // so this deleteMany is a no-op — but we don't 404 because the user
    // shouldn't see a "پیام یافت نشد" error when clearing an old save).

    await db.messageSaved.deleteMany({
      where: { messageId: id, userId: user.id },
    });

    return NextResponse.json({ data: { saved: false } });
  },
);
