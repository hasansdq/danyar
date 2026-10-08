import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_CONTENT_LEN = 2000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * DELETE /api/messages/[id]
 *
 * Soft-deletes a message (sets deletedAt + deletedById). The realtime
 * `message_deleted` socket.io event is emitted by the chat mini-service
 * (Task 2-b); this REST route only persists state.
 *
 * Permission rules:
 *  - ADMIN or TEACHER of the class → can delete ANY message anytime.
 *  - STUDENT → can delete ONLY their own message, and only within 12 hours
 *    of `createdAt`. Otherwise returns 403 with a Persian message.
 *  - If the message is already deleted (deletedAt != null), returns 200
 *    idempotently with the existing deletedBy/DeletedAt info.
 *
 * Permission gate: "delete_message" (no-op for SUPERADMIN).
 */
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    await assertPermission(user.role, "delete_message");
    const { id } = await ctx.params;
    if (!id) return notFound();

    const message = await db.message.findUnique({
      where: { id },
      include: {
        sender: {
          select: { id: true, fullName: true, role: true, username: true },
        },
      },
    });

    if (!message) {
      return notFound("پیام یافت نشد");
    }

    // SECURITY (school scoping): an ADMIN (principal) may only delete
    // messages of classes in their OWN school (message → classId →
    // class.schoolId). SUPERADMIN is unscoped; TEACHER/STUDENT membership
    // rules are unchanged.
    const adminInSchoolScope =
      user.role === "ADMIN"
        ? (await assertClassSchoolScope(user, message.classId)) === null
        : false;

    // Verify the requester is a member of the message's class.
    const membership = await verifyMembership(user.id, message.classId);
    if (!membership && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // ADMIN (principal) without membership must be scoped to the class's
    // school — otherwise cross-school deletion is rejected.
    if (!membership && !adminInSchoolScope) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Idempotent: if already deleted, no-op.
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

    // Permission gate:
    //  - ADMIN or TEACHER of the class → can delete anytime.
    //  - STUDENT → only their own message, within 12 hours of createdAt.
    const isTeacherOfClass =
      membership?.role === "TEACHER" || adminInSchoolScope;
    if (!isTeacherOfClass) {
      // Student path — only own message + within 12 hours.
      if (message.senderId !== user.id) {
        return NextResponse.json(
          { error: "شما فقط می‌توانید پیام خود را حذف کنید" },
          { status: 403 },
        );
      }
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
    }

    const now = new Date();
    const updated = await db.message.update({
      where: { id: message.id },
      data: {
        deletedAt: now,
        deletedById: user.id,
      },
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        deleted: true,
        deletedAt: updated.deletedAt!.toISOString(),
        deletedById: updated.deletedById,
      },
    });
  },
);

/**
 * PATCH /api/messages/[id]
 *
 * Edits the content of a message (sets `editedAt` to now and writes the new
 * `content`). Same permission rules as DELETE:
 *   - ADMIN or TEACHER of the class → can edit any message anytime.
 *   - STUDENT → can edit ONLY their own message AND only within 12h of send.
 *   - SUPERADMIN → bypasses the gate.
 *
 * Body: `{ content: string }` (the new content). The content must be a
 * non-empty string of <= 2000 chars (matches the send_message limit).
 *
 * Returns the updated message with all phase-17 fields (replyToId /
 * forwardedFromId / editedAt / readCount + sender + file fields) so the
 * frontend can swap the row in place. The realtime `message_edited`
 * broadcast is emitted by the chat mini-service — this REST route only
 * persists state.
 */
export const PATCH = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await requireAuth();
    await assertPermission(user.role, "delete_message");
    const { id } = await ctx.params;
    if (!id) return notFound();

    // Parse the JSON body — only `content` is accepted.
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    const newContent =
      typeof body?.content === "string" ? body.content.trim() : "";
    if (!newContent) {
      return badRequest("محتوای پیام خالی است");
    }
    if (newContent.length > MAX_CONTENT_LEN) {
      return NextResponse.json(
        { error: "پیام نباید بیش از ۲۰۰۰ کاراکتر باشد" },
        { status: 400 },
      );
    }

    // Load the message + its class so we can verify access.
    const message = await db.message.findUnique({
      where: { id },
      select: {
        id: true,
        classId: true,
        senderId: true,
        createdAt: true,
        deletedAt: true,
        replyToId: true,
        forwardedFromId: true,
        editedAt: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        mimeType: true,
        isAnnouncement: true,
        content: true,
      },
    });

    if (!message) {
      return notFound("پیام یافت نشد");
    }

    // Don't allow editing a soft-deleted message.
    if (message.deletedAt) {
      return NextResponse.json(
        { error: "این پیام حذف شده و قابل ویرایش نیست" },
        { status: 400 },
      );
    }

    // Access control: verify the requester is a member of the message's
    // class OR a SUPERADMIN OR an ADMIN (principal of the school). The
    // check mirrors DELETE — ADMINs moderate any class in their school
    // even without a membership row.
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

    // Permission gate:
    //  - ADMIN/TEACHER of the class OR principal of the school OR SUPERADMIN
    //    → can edit anytime (they're the moderators).
    //  - STUDENT → only their OWN message, within 12h of createdAt.
    const canModerate =
      isSuperAdmin ||
      isPrincipalOfClass ||
      membership?.role === "TEACHER" ||
      user.role === "ADMIN";
    if (!canModerate) {
      if (message.senderId !== user.id) {
        return NextResponse.json(
          { error: "شما فقط می‌توانید پیام خود را ویرایش کنید" },
          { status: 403 },
        );
      }
      const elapsed = Date.now() - message.createdAt.getTime();
      if (elapsed > TWELVE_HOURS_MS) {
        return NextResponse.json(
          {
            error:
              "شما فقط تا ۱۲ ساعت پس از ارسال می‌توانید پیام خود را ویرایش کنید",
          },
          { status: 403 },
        );
      }
    }

    const now = new Date();
    const updated = await db.message.update({
      where: { id: message.id },
      data: {
        content: newContent,
        editedAt: now,
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            role: true,
            username: true,
            avatar: true,
          },
        },
        _count: { select: { reads: true } },
      },
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        classId: updated.classId,
        senderId: updated.senderId,
        content: updated.content,
        createdAt: updated.createdAt.toISOString(),
        isAnnouncement: updated.isAnnouncement,
        replyToId: updated.replyToId,
        forwardedFromId: updated.forwardedFromId,
        editedAt: updated.editedAt ? updated.editedAt.toISOString() : null,
        readCount: updated._count.reads,
        deletedAt: updated.deletedAt ? updated.deletedAt.toISOString() : null,
        deletedById: updated.deletedById,
        fileUrl: updated.fileUrl,
        fileName: updated.fileName,
        fileType: updated.fileType,
        fileSize: updated.fileSize,
        mimeType: updated.mimeType,
        sender: updated.sender,
      },
    });
  },
);
