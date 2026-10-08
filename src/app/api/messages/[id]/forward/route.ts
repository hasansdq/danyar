import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertModule } from "@/lib/module-check";
import { assertPermission } from "@/lib/permission-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/messages/[id]/forward
 *
 * Forwards the message identified by [id] into the class identified by the
 * `targetClassId` body field. The new message:
 *   - lives in the target class,
 *   - is authored by the requester (senderId = current user),
 *   - copies `content` AND any file-attachment fields from the original,
 *   - stores `forwardedFromId = original.id` so the UI can show a
 *     "forwarded from <sender>" banner above the bubble.
 *
 * Permission rules:
 *  - The requester MUST be a member of BOTH the source message's class AND
 *    the target class — OR a principal (ADMIN) of the school that owns
 *    either class — OR a SUPERADMIN.
 *  - If the target class chat is closed AND the requester is a STUDENT,
 *    returns 403 (same as POST /api/messages).
 *  - We never forward a soft-deleted message (the original is hidden from
 *    the UI anyway).
 *
 * Body: `{ targetClassId: string }` (JSON).
 *
 * Returns the new forwarded message with all phase-17 fields. The frontend
 * relays it to the target class room via the `relay_message` socket event
 * (with the target classId) so members of THAT class see it in real time.
 */
export const POST = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await requireAuth();
    await assertModule(user.role, "class_chat");
    await assertPermission(user.role, "chat");
    const { id } = await ctx.params;
    if (!id) return notFound("شناسه پیام الزامی است");

    // Parse the JSON body — only `targetClassId` is accepted.
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    const targetClassId =
      typeof body?.targetClassId === "string" ? body.targetClassId.trim() : "";
    if (!targetClassId) {
      return badRequest("targetClassId الزامی است");
    }

    // ---------------------------------------------------------------------------
    // Load the source message + its class.
    // ---------------------------------------------------------------------------
    const sourceMessage = await db.message.findUnique({
      where: { id },
      select: {
        id: true,
        classId: true,
        senderId: true,
        content: true,
        deletedAt: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        mimeType: true,
        isAnnouncement: true,
      },
    });
    if (!sourceMessage) {
      return notFound("پیام یافت نشد");
    }
    if (sourceMessage.deletedAt) {
      return NextResponse.json(
        { error: "این پیام حذف شده و قابل بازپخش نیست" },
        { status: 400 },
      );
    }
    if (targetClassId === sourceMessage.classId) {
      return NextResponse.json(
        { error: "بازپخش به همان کلاس بی‌معنی است" },
        { status: 400 },
      );
    }

    // ---------------------------------------------------------------------------
    // Access control: member of BOTH classes OR ADMIN principal of either
    // class's school OR SUPERADMIN.
    // ---------------------------------------------------------------------------
    const sourceClass = await db.classRoom.findUnique({
      where: { id: sourceMessage.classId },
      select: { id: true, schoolId: true, chatClosed: true },
    });
    const targetClass = await db.classRoom.findUnique({
      where: { id: targetClassId },
      select: {
        id: true,
        schoolId: true,
        chatClosed: true,
        fileUploadEnabled: true,
        maxFileSizeMb: true,
        allowedFileTypes: true,
      },
    });
    if (!sourceClass) return notFound("کلاس مبدأ یافت نشد");
    if (!targetClass) return notFound("کلاس مقصد یافت نشد");

    const isSuperAdmin = user.role === "SUPERADMIN";
    const isPrincipalOfSource =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      sourceClass.schoolId === user.schoolId;
    const isPrincipalOfTarget =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      targetClass.schoolId === user.schoolId;

    const sourceMembership = await verifyMembership(user.id, sourceMessage.classId);
    const targetMembership = await verifyMembership(user.id, targetClassId);

    const canAccessSource =
      isSuperAdmin || isPrincipalOfSource || !!sourceMembership;
    const canAccessTarget =
      isSuperAdmin || isPrincipalOfTarget || !!targetMembership;
    if (!canAccessSource || !canAccessTarget) {
      return NextResponse.json(
        { error: "شما به یکی از کلاس‌های مبدأ یا مقصد دسترسی ندارید" },
        { status: 403 },
      );
    }

    // If the target chat is closed and the sender is a STUDENT, refuse.
    // (Principals and teachers can still forward — they're the closers.)
    const effectiveRoleForChatClosed =
      isSuperAdmin || isPrincipalOfTarget || user.role === "ADMIN"
        ? "ADMIN"
        : targetMembership?.role ?? "STUDENT";
    if (targetClass.chatClosed && effectiveRoleForChatClosed === "STUDENT") {
      return NextResponse.json(
        { error: "این گفتگو توسط معلم/مدیر بسته شده است" },
        { status: 403 },
      );
    }

    // If the source carries a file, the target class must allow file uploads
    // (otherwise the forwarded copy would carry a file the target class
    // forbids — the user would have to download + re-upload manually).
    if (sourceMessage.fileUrl && !targetClass.fileUploadEnabled) {
      return NextResponse.json(
        { error: "ارسال فایل در کلاس مقصد غیرفعال است" },
        { status: 403 },
      );
    }

    // ---------------------------------------------------------------------------
    // Create the forwarded copy.
    // ---------------------------------------------------------------------------
    const forwarded = await db.message.create({
      data: {
        classId: targetClassId,
        senderId: user.id,
        content: sourceMessage.content,
        // Wire the forward-chain metadata.
        forwardedFromId: sourceMessage.id,
        // Copy the file-attachment fields so the forwarded message shows the
        // same file (the fileUrl is a public /uploads/... path so it's
        // safe to share between classes).
        fileUrl: sourceMessage.fileUrl,
        fileName: sourceMessage.fileName,
        fileType: sourceMessage.fileType,
        fileSize: sourceMessage.fileSize,
        mimeType: sourceMessage.mimeType,
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

    return NextResponse.json(
      {
        data: {
          id: forwarded.id,
          classId: forwarded.classId,
          senderId: forwarded.senderId,
          content: forwarded.content,
          createdAt: forwarded.createdAt.toISOString(),
          isAnnouncement: forwarded.isAnnouncement,
          replyToId: forwarded.replyToId,
          forwardedFromId: forwarded.forwardedFromId,
          editedAt: forwarded.editedAt
            ? forwarded.editedAt.toISOString()
            : null,
          readCount: forwarded._count.reads,
          deletedAt: forwarded.deletedAt
            ? forwarded.deletedAt.toISOString()
            : null,
          deletedById: forwarded.deletedById,
          fileUrl: forwarded.fileUrl,
          fileName: forwarded.fileName,
          fileType: forwarded.fileType,
          fileSize: forwarded.fileSize,
          mimeType: forwarded.mimeType,
          sender: forwarded.sender,
          // Include the original message's preview so the frontend can show
          // a "forwarded from <sender>" banner above the bubble on the
          // optimistic append without a second round-trip.
          forwardedFrom: {
            id: sourceMessage.id,
            senderId: sourceMessage.senderId,
            content: sourceMessage.content,
          },
        },
      },
      { status: 201 },
    );
  },
);
