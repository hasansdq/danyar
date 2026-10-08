import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { assertModule } from "@/lib/module-check";
import { saveFormDataFile } from "@/lib/upload";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// SECURITY (resource abuse): maximum text length of a direct message —
// mirrors the /api/messages POST + PATCH limit.
const MAX_CONTENT_LEN = 2000;

// ---------------------------------------------------------------------------
// File-category helpers (mirror /api/messages)
// ---------------------------------------------------------------------------
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const PDF_EXT = new Set(["pdf"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "avi", "m4v", "mkv"]);

const IMAGE_MIME = /^image\//i;
const PDF_MIME = /^application\/pdf/i;
const VIDEO_MIME = /^video\//i;

export type FileCategory = "image" | "pdf" | "video" | "file";

function detectFileCategory(mimeType: string, originalName: string): FileCategory {
  if (mimeType) {
    if (PDF_MIME.test(mimeType)) return "pdf";
    if (IMAGE_MIME.test(mimeType)) return "image";
    if (VIDEO_MIME.test(mimeType)) return "video";
  }
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  if (PDF_EXT.has(ext)) return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  return "file";
}

/**
 * Returns the DirectChat row if the requester is a participant (userA or
 * userB), else null. Also returns the "other user" id for convenience.
 */
async function findParticipantChat(
  userId: string,
  chatId: string,
): Promise<{ id: string; userAId: string; userBId: string; schoolId: string | null } | null> {
  const chat = await db.directChat.findUnique({
    where: { id: chatId },
    select: { id: true, userAId: true, userBId: true, schoolId: true },
  });
  if (!chat) return null;
  if (chat.userAId !== userId && chat.userBId !== userId) return null;
  return chat;
}

/**
 * GET /api/direct-messages?chatId=<id>&cursor=<isoDate>&limit=50
 *
 * Paginated direct messages, newest first. Includes sender
 * `{ id, fullName, role, username, avatar }`. Filters out soft-deleted
 * (`deletedAt != null`) messages. Verifies the requester is a participant
 * of the chat (userA or userB).
 *
 * Returns: `{ data: [...], nextCursor, hasMore }`.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "direct_chat");

  const chatId = req.nextUrl.searchParams.get("chatId");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(100, Number(limitRaw) || 50));

  if (!chatId) return badRequest("chatId الزامی است");

  const chat = await findParticipantChat(user.id, chatId);
  if (!chat) {
    return NextResponse.json(
      { error: "دسترسی به این گفتگو مجاز نیست" },
      { status: 403 },
    );
  }

  let cursorDate: Date | null = null;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      return badRequest("Invalid cursor date");
    }
    cursorDate = parsed;
  }

  const messages = await db.directMessage.findMany({
    where: {
      chatId,
      deletedAt: null,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
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
    },
  });

  const hasMore = messages.length > limit;
  const sliced = hasMore ? messages.slice(0, limit) : messages;

  const otherUserId = chat.userAId === user.id ? chat.userBId : chat.userAId;

  return NextResponse.json({
    data: sliced.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      // Read-receipt: null when the recipient hasn't opened the chat yet,
      // ISO string when they have. The frontend renders blue ticks for the
      // SENDER's own messages when readAt is set.
      readAt: m.readAt ? m.readAt.toISOString() : null,
      deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
      deletedById: m.deletedById,
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      fileType: m.fileType,
      fileSize: m.fileSize,
      mimeType: m.mimeType,
      sender: m.sender,
    })),
    nextCursor:
      hasMore && sliced.length > 0
        ? sliced[sliced.length - 1].createdAt.toISOString()
        : null,
    hasMore,
    otherUserId,
  });
});

/**
 * POST /api/direct-messages
 *
 * Accepts EITHER:
 *   - application/json: `{ chatId, content? }`
 *   - multipart/form-data: `chatId`, `content?`, `file?`
 *
 * Validates that the requester is a participant of the chat. Content must
 * be non-empty OR a file present. On success:
 *   - Creates a DirectMessage row.
 *   - Updates `DirectChat.lastMessageAt`.
 *   - Returns the created message (with sender) + `chatId` + `otherUserId`
 *     so the frontend can relay it via socket.io.
 *
 * Returns: `{ data: { message, chatId, otherUserId } }` (HTTP 201).
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "direct_chat");

  const contentType = req.headers.get("content-type") || "";

  let chatId: string | undefined;
  let content: string | undefined;
  let file: File | null = null;

  if (contentType.startsWith("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest("Invalid multipart body");
    }

    const chatIdVal = formData.get("chatId");
    if (typeof chatIdVal !== "string" || chatIdVal.trim().length === 0) {
      return badRequest("chatId الزامی است");
    }
    chatId = chatIdVal;

    const contentVal = formData.get("content");
    if (contentVal !== null && typeof contentVal === "string") {
      content = contentVal;
    }

    const fileVal = formData.get("file");
    if (fileVal !== null && fileVal instanceof File) {
      file = fileVal;
    }
  } else {
    let body: { chatId?: string; content?: string };
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    chatId = body?.chatId;
    content = body?.content;
  }

  if (!chatId) return badRequest("chatId الزامی است");

  // SECURITY (resource abuse): cap the text content length for BOTH the
  // JSON and multipart paths (checked right after `content` is read) —
  // mirrors the /api/messages POST limit.
  if (typeof content === "string" && content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: "متن پیام نمی‌تواند بیش از ۲۰۰۰ کاراکتر باشد" },
      { status: 400 },
    );
  }

  const hasText =
    typeof content === "string" && content.trim().length > 0;
  const hasFile = !!file && file.size > 0;
  if (!hasText && !hasFile) {
    return badRequest("پیام خالی است");
  }

  const chat = await findParticipantChat(user.id, chatId);
  if (!chat) {
    return NextResponse.json(
      { error: "دسترسی به این گفتگو مجاز نیست" },
      { status: 403 },
    );
  }

  // ---------------------------------------------------------------------------
  // File handling (mirror /api/messages)
  // ---------------------------------------------------------------------------
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let fileType: string | null = null;
  let fileSize: number | null = null;
  let mimeType: string | null = null;

  if (file) {
    const category = detectFileCategory(file.type || "", file.name || "");
    const saved = await saveFormDataFile(file, { actorId: user.id });
    if (!saved) {
      return NextResponse.json(
        { error: "پسوند این فایل پشتیبانی نمی‌شود" },
        { status: 415 },
      );
    }
    fileUrl = saved.fileUrl;
    fileName = saved.originalName;
    fileType = category;
    fileSize = saved.fileSize;
    mimeType = saved.mimeType;
  }

  // Persist message + bump lastMessageAt atomically.
  const message = await db.directMessage.create({
    data: {
      chatId,
      senderId: user.id,
      content: hasText ? (content as string).trim() : "",
      fileUrl,
      fileName,
      fileType,
      fileSize,
      mimeType,
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
    },
  });

  await db.directChat.update({
    where: { id: chatId },
    data: { lastMessageAt: message.createdAt },
  });

  const otherUserId = chat.userAId === user.id ? chat.userBId : chat.userAId;

  return NextResponse.json(
    {
      data: {
        message: {
          id: message.id,
          chatId: message.chatId,
          senderId: message.senderId,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          // New message — recipient hasn't seen it yet, so readAt is null.
          // The frontend renders single ✓; once the recipient opens the chat
          // (mark_direct_read socket event), this gets updated to an ISO
          // string and the SENDER's UI flips to double ✓✓ (blue).
          readAt: message.readAt ? message.readAt.toISOString() : null,
          deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
          deletedById: message.deletedById,
          fileUrl: message.fileUrl,
          fileName: message.fileName,
          fileType: message.fileType,
          fileSize: message.fileSize,
          mimeType: message.mimeType,
          sender: message.sender,
        },
        chatId,
        otherUserId,
      },
    },
    { status: 201 },
  );
});
