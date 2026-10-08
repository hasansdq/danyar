import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { saveFormDataFile } from "@/lib/upload";
import { db } from "@/lib/db";
import { sendNotificationToUser } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

// SECURITY (resource abuse): maximum text length of a chat message —
// mirrors the PATCH /api/messages/[id] limit.
const MAX_CONTENT_LEN = 2000;

type SessionUser = {
  id: string;
  role: string;
  schoolId?: string | null;
};

/**
 * Returns true if the calling user is allowed to access `classId`:
 *   - they have a ClassMembership row in the class, OR
 *   - they are an ADMIN and the class is in their school, OR
 *   - they are a SUPERADMIN (unscoped).
 *
 * Used by GET + POST /api/messages to let principals read/send chat in
 * any class in their school, even though they have no ClassMembership row
 * there.
 */
async function canAccessClass(
  user: SessionUser,
  classId: string,
): Promise<{ ok: boolean; membershipRole: "STUDENT" | "TEACHER" | "ADMIN" | null }> {
  if (user.role === "SUPERADMIN") {
    return { ok: true, membershipRole: "ADMIN" };
  }
  if (user.role === "ADMIN") {
    const cls = await db.classRoom.findUnique({
      where: { id: classId },
      select: { schoolId: true },
    });
    if (cls?.schoolId && cls.schoolId === user.schoolId) {
      return { ok: true, membershipRole: "ADMIN" };
    }
    // Fall back to the explicit-membership path (principal enrolled as
    // TEACHER/STUDENT in a class outside their school — extremely unlikely
    // but technically possible).
  }
  const membership = await verifyMembership(user.id, classId);
  if (!membership) {
    return { ok: false, membershipRole: null };
  }
  return { ok: true, membershipRole: membership.role as "STUDENT" | "TEACHER" | "ADMIN" | null };
}

// ---------------------------------------------------------------------------
// File-category helpers
// ---------------------------------------------------------------------------

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const PDF_EXT = new Set(["pdf"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "avi", "m4v", "mkv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "wma"]);

const IMAGE_MIME = /^image\//i;
const PDF_MIME = /^application\/pdf/i;
const VIDEO_MIME = /^video\//i;
const AUDIO_MIME = /^audio\//i;

export type FileCategory = "image" | "pdf" | "video" | "audio" | "file";

/**
 * Returns the file category ("image" | "pdf" | "video" | "file") for a given
 * upload, preferring MIME type and falling back to the file extension.
 */
function detectFileCategory(mimeType: string, originalName: string): FileCategory {
  if (mimeType) {
    if (PDF_MIME.test(mimeType)) return "pdf";
    if (IMAGE_MIME.test(mimeType)) return "image";
    if (VIDEO_MIME.test(mimeType)) return "video";
    if (AUDIO_MIME.test(mimeType)) return "audio";
  }
  const ext = (originalName.split(".").pop() || "").toLowerCase();
  if (PDF_EXT.has(ext)) return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "file";
}

/**
 * GET /api/messages?classId=<id>&cursor=<isoDate>&limit=<int>
 *
 * Returns paginated messages for the class, newest first, with sender
 * {id, fullName, role, username, avatar}. Older messages fetched via cursor
 * (createdAt < cursor). Default limit 50. Includes the file attachment fields
 * (fileUrl, fileName, fileType, fileSize, mimeType).
 *
 * Phase 17 additions: each message also carries `replyToId`,
 * `forwardedFromId`, `editedAt` (all nullable), `readCount` (the number of
 * MessageRead rows — used by the UI to render "N دیده‌اند"), and a
 * `replyTo` preview `{ id, content, sender }` when `replyToId` is set
 * (batch-loaded in one query for the whole page so the page doesn't fan
 * out into N+1 selects).
 *
 * Phase 18 additions: each message also carries `isSaved` (whether the
 * current user has a MessageSaved row for this message — for the bookmark
 * toggle UI) and `savedCount` (total number of MessageSaved rows — for the
 * "N ذخیره" badge). Both are batch-loaded in one query each for the whole
 * page so the page doesn't fan out into N+1 selects.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "class_chat");

  const classId = req.nextUrl.searchParams.get("classId");
  const cursor = req.nextUrl.searchParams.get("cursor");
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(100, Number(limitRaw) || 50));

  if (!classId) return badRequest("classId is required");

  const access = await canAccessClass(user, classId);
  if (!access.ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Permission gate for students.
  if (user.role === "STUDENT") {
    await assertPermission(user.role, "chat");
  }

  let cursorDate: Date | null = null;
  if (cursor) {
    const parsed = new Date(cursor);
    if (Number.isNaN(parsed.getTime())) {
      return badRequest("Invalid cursor date");
    }
    cursorDate = parsed;
  }

  const messages = await db.message.findMany({
    where: {
      classId,
      deletedAt: null, // exclude soft-deleted messages
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // fetch one extra to detect next page
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
      // Phase 19 — include the linked assignment / sample-question rows so
      // the chat can render the special "card" message bubble without a
      // second round-trip per message. Both relations are nullable; absent
      // for plain text messages. We pick the few fields the chat card needs
      // (id, title, dueDate, fileUrl, fileName).
      linkedAssignment: {
        select: {
          id: true,
          title: true,
          dueDate: true,
          fileUrl: true,
          fileName: true,
        },
      },
      linkedSampleQuestion: {
        select: {
          id: true,
          title: true,
          fileUrl: true,
          fileName: true,
        },
      },
      // Count of read receipts — used to render "N دیده‌اند" in the UI.
      _count: {
        select: { reads: true, saves: true },
      },
    },
  });

  const hasMore = messages.length > limit;
  const sliced = hasMore ? messages.slice(0, limit) : messages;

  // ---------------------------------------------------------------------------
  // Batch-load the replied-to messages for the entire page in ONE query so we
  // don't fan out into N+1 selects when many messages in the page are replies.
  // ---------------------------------------------------------------------------
  const replyToIds = sliced
    .map((m) => m.replyToId)
    .filter((id): id is string => !!id);
  const uniqueReplyToIds = Array.from(new Set(replyToIds));

  let replyToMap: Map<
    string,
    { id: string; content: string; sender: { id: string; fullName: string; role: string } }
  > = new Map();
  if (uniqueReplyToIds.length > 0) {
    const repliedMessages = await db.message.findMany({
      where: { id: { in: uniqueReplyToIds } },
      select: {
        id: true,
        content: true,
        sender: { select: { id: true, fullName: true, role: true } },
      },
    });
    replyToMap = new Map(
      repliedMessages.map((m) => [
        m.id,
        {
          id: m.id,
          content: m.content,
          sender: m.sender,
        },
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  // Phase 18: batch-load the current user's MessageSaved rows for the whole
  // page so we can set `isSaved` per message without an N+1 fan-out. ONE query
  // filters by (userId = me, messageId IN [page ids]).
  // ---------------------------------------------------------------------------
  const pageMessageIds = sliced.map((m) => m.id);
  const mySaves = pageMessageIds.length
    ? await db.messageSaved.findMany({
        where: { userId: user.id, messageId: { in: pageMessageIds } },
        select: { messageId: true },
      })
    : [];
  const mySavedSet = new Set(mySaves.map((r) => r.messageId));

  return NextResponse.json({
    data: sliced.map((m) => ({
      id: m.id,
      classId: m.classId,
      senderId: m.senderId,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      isAnnouncement: m.isAnnouncement,
      // Reply / forward / edit metadata (phase 17).
      replyToId: m.replyToId,
      replyTo: m.replyToId ? (replyToMap.get(m.replyToId) ?? null) : null,
      forwardedFromId: m.forwardedFromId,
      editedAt: m.editedAt ? m.editedAt.toISOString() : null,
      readCount: m._count.reads,
      // Phase 18 save metadata.
      isSaved: mySavedSet.has(m.id),
      savedCount: m._count.saves,
      // Phase 19 — linked assignment / sample-question card metadata.
      // Both are null for plain text messages. When set, the chat renders a
      // bordered "card" bubble with the linked item's title + due date (for
      // assignments) + a button to open the matching feature Sheet.
      linkedAssignmentId: m.linkedAssignmentId,
      linkedSampleQuestionId: m.linkedSampleQuestionId,
      linkedAssignment: m.linkedAssignment
        ? {
            id: m.linkedAssignment.id,
            title: m.linkedAssignment.title,
            dueDate: m.linkedAssignment.dueDate
              ? m.linkedAssignment.dueDate.toISOString()
              : null,
            fileUrl: m.linkedAssignment.fileUrl,
            fileName: m.linkedAssignment.fileName,
          }
        : null,
      linkedSampleQuestion: m.linkedSampleQuestion
        ? {
            id: m.linkedSampleQuestion.id,
            title: m.linkedSampleQuestion.title,
            fileUrl: m.linkedSampleQuestion.fileUrl,
            fileName: m.linkedSampleQuestion.fileName,
          }
        : null,
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
  });
});

/**
 * POST /api/messages
 *
 * Accepts EITHER:
 *   - application/json body:  { classId, content, replyToId?, linkedAssignmentId?, linkedSampleQuestionId? }
 *   - multipart/form-data:     classId (string), content (optional caption),
 *                              file (File attachment), replyToId? (optional),
 *                              linkedAssignmentId? (optional),
 *                              linkedSampleQuestionId? (optional)
 *
 * Authorization: the user must be a member of the class. If the class chat is
 * closed AND the sender is a STUDENT, returns 403. File uploads are validated
 * against the class's file-upload settings (fileUploadEnabled, maxFileSizeMb,
 * allowedFileTypes). The message must have EITHER non-empty content OR a file
 * OR a linked assignment/sample-question id (the linked-card messages carry
 * the assignment title as `content`, but we relax the empty-content rule for
 * linked-only posts so a teacher can forward an assignment without typing any
 * extra text).
 *
 * `replyToId` (phase 17): when provided, must reference an EXISTING message in
 * the SAME class. We validate this once we've loaded the ClassRoom (404 / 400
 * otherwise). The created message stores `replyToId` so the GET handler can
 * render the reply-preview above the bubble.
 *
 * `linkedAssignmentId` / `linkedSampleQuestionId` (phase 19): when provided,
 * must reference an EXISTING Assignment / SampleQuestion row in the SAME class.
 * The created message stores the foreign key; the GET handler joins the row so
 * the chat can render the special "card" bubble (assignment icon + title + due
 * date + "مشاهده تکلیف" button). Used by the "ارسال به گفتگو" affordance in
 * the assignments-view + sample-questions-view Sheets.
 *
 * Returns the created message in the same shape as GET /api/messages items
 * (with sender + file fields + replyToId/forwardedFromId/editedAt/readCount
 * — all the phase-17 fields, plus the phase-19 linked card metadata) so the
 * frontend can optimistically render it and (for file uploads) emit a
 * `relay_message` socket event.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "class_chat");

  // Permission gate: "chat" is required for any message send (no-op for SUPERADMIN).
  await assertPermission(user.role, "chat");

  const contentType = req.headers.get("content-type") || "";

  let classId: string | undefined;
  let content: string | undefined;
  let file: File | null = null;
  let replyToId: string | undefined;
  // Phase 19 — linked assignment / sample-question ids. When set, the chat
  // renders the message as a bordered "card" bubble instead of a text bubble.
  let linkedAssignmentId: string | undefined;
  let linkedSampleQuestionId: string | undefined;

  if (contentType.startsWith("multipart/form-data")) {
    // ---------------------------------------------------------------------
    // multipart/form-data path — text + optional file
    // ---------------------------------------------------------------------
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest("Invalid multipart body");
    }

    const classIdVal = formData.get("classId");
    if (typeof classIdVal !== "string" || classIdVal.trim().length === 0) {
      return badRequest("classId is required");
    }
    classId = classIdVal;

    const contentVal = formData.get("content");
    if (contentVal !== null && typeof contentVal === "string") {
      content = contentVal;
    }

    const fileVal = formData.get("file");
    if (fileVal !== null && fileVal instanceof File) {
      file = fileVal;
    }

    const replyToIdVal = formData.get("replyToId");
    if (replyToIdVal !== null && typeof replyToIdVal === "string" && replyToIdVal.trim().length > 0) {
      replyToId = replyToIdVal.trim();
    }

    // Phase 19 — linked assignment / sample-question ids (forward-to-chat).
    const linkedAssignmentIdVal = formData.get("linkedAssignmentId");
    if (
      linkedAssignmentIdVal !== null &&
      typeof linkedAssignmentIdVal === "string" &&
      linkedAssignmentIdVal.trim().length > 0
    ) {
      linkedAssignmentId = linkedAssignmentIdVal.trim();
    }
    const linkedSampleQuestionIdVal = formData.get("linkedSampleQuestionId");
    if (
      linkedSampleQuestionIdVal !== null &&
      typeof linkedSampleQuestionIdVal === "string" &&
      linkedSampleQuestionIdVal.trim().length > 0
    ) {
      linkedSampleQuestionId = linkedSampleQuestionIdVal.trim();
    }
  } else {
    // ---------------------------------------------------------------------
    // JSON path — text-only (existing behaviour)
    // ---------------------------------------------------------------------
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    classId = body?.classId;
    content = body?.content;
    if (typeof body?.replyToId === "string" && body.replyToId.trim().length > 0) {
      replyToId = body.replyToId.trim();
    }
    if (
      typeof body?.linkedAssignmentId === "string" &&
      body.linkedAssignmentId.trim().length > 0
    ) {
      linkedAssignmentId = body.linkedAssignmentId.trim();
    }
    if (
      typeof body?.linkedSampleQuestionId === "string" &&
      body.linkedSampleQuestionId.trim().length > 0
    ) {
      linkedSampleQuestionId = body.linkedSampleQuestionId.trim();
    }
  }

  if (!classId) return badRequest("classId is required");

  // SECURITY (resource abuse): cap the text content length for BOTH the
  // JSON and multipart paths (checked right after `content` is read) —
  // mirrors the PATCH /api/messages/[id] limit.
  if (typeof content === "string" && content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: "متن پیام نمی‌تواند بیش از ۲۰۰۰ کاراکتر باشد" },
      { status: 400 },
    );
  }

  // A message needs EITHER non-empty text content OR a file attachment OR a
  // linked assignment/sample-question id (the linked-card messages carry the
  // assignment title as `content`, but we relax the empty-content rule for
  // linked-only posts so a teacher can forward an assignment without typing
  // any extra text).
  const hasText =
    typeof content === "string" && content.trim().length > 0;
  const hasFile = !!file && file.size > 0;
  const hasLinked =
    !!linkedAssignmentId || !!linkedSampleQuestionId;
  if (!hasText && !hasFile && !hasLinked) {
    return badRequest("پیام خالی است");
  }

  // Permission + module gates: file uploads additionally require "file_upload"
  // (per-role) AND the global `file_upload` module to be enabled.
  if (hasFile) {
    await assertPermission(user.role, "file_upload");
    await assertModule(user.role, "file_upload");
  }

  // ---------------------------------------------------------------------------
  // Membership + class lookup
  // ---------------------------------------------------------------------------
  const membership = await verifyMembership(user.id, classId);

  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: {
      chatClosed: true,
      fileUploadEnabled: true,
      maxFileSizeMb: true,
      allowedFileTypes: true,
      schoolId: true,
    },
  });
  if (!cls) {
    return NextResponse.json(
      { error: "Class not found" },
      { status: 404 },
    );
  }

  // Access control: members can always send; principals (ADMIN) can also
  // send to ANY class in their school even without a membership row, and
  // are treated like teachers (they can post to closed chats — they're the
  // closers). SUPERADMIN bypasses entirely.
  const isPrincipalOfClass =
    user.role === "ADMIN" &&
    !!user.schoolId &&
    cls.schoolId === user.schoolId;
  const isSuperAdmin = user.role === "SUPERADMIN";

  if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Effective sender role for the chatClosed check below. Principals and
  // super-admins are moderators (like teachers) — they can post to closed
  // chats because they're the closers.
  const effectiveRoleForChatClosed =
    user.role === "ADMIN" || user.role === "SUPERADMIN"
      ? "ADMIN"
      : membership?.role ?? "STUDENT";

  // If the chat is closed, STUDENTS cannot send (teachers/admins still can).
  if (cls.chatClosed && effectiveRoleForChatClosed === "STUDENT") {
    return NextResponse.json(
      { error: "این گفتگو توسط معلم/مدیر بسته شده است" },
      { status: 403 },
    );
  }

  // ---------------------------------------------------------------------------
  // File validation (only when a file is attached)
  // ---------------------------------------------------------------------------
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let fileType: string | null = null;
  let fileSize: number | null = null;
  let mimeType: string | null = null;

  if (file) {
    if (!cls.fileUploadEnabled) {
      return NextResponse.json(
        { error: "ارسال فایل در این کلاس غیرفعال است" },
        { status: 403 },
      );
    }

    // Determine the file's category (image | pdf | video | file).
    const category = detectFileCategory(file.type || "", file.name || "");

    // Check the per-class allowed-type allow-list (null = all allowed).
    if (cls.allowedFileTypes) {
      let allowed: string[] = [];
      try {
        const parsed = JSON.parse(cls.allowedFileTypes);
        if (Array.isArray(parsed)) {
          allowed = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch {
        // Malformed JSON in DB — treat as "all allowed" rather than blocking.
        allowed = [];
      }
      if (allowed.length > 0 && !allowed.includes(category)) {
        const persianLabels = allowed.map((t) => {
          if (t === "image") return "تصویر";
          if (t === "pdf") return "PDF";
          if (t === "video") return "ویدئو";
          return "فایل";
        });
        return NextResponse.json(
          {
            error: `این نوع فایل مجاز نیست. انواع مجاز: ${persianLabels.join("، ")}`,
          },
          { status: 403 },
        );
      }
    }

    // Check the per-class size cap (0 = no limit).
    if (cls.maxFileSizeMb > 0) {
      const maxBytes = cls.maxFileSizeMb * 1024 * 1024;
      if (file.size > maxBytes) {
        return NextResponse.json(
          {
            error: `حداکثر حجم فایل ${cls.maxFileSizeMb} مگابایت است`,
          },
          { status: 413 },
        );
      }
    }

    // Save to /public/uploads — the helper has its own extension allow-list
    // and throws "FILE_TOO_LARGE" / "INVALID_EXTENSION" on failure. The
    // apiHandler wrapper converts these to 413 / 415 responses.
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

  // ---------------------------------------------------------------------------
  // replyToId validation (phase 17)
  // ---------------------------------------------------------------------------
  // If the caller supplied a replyToId, the replied-to message MUST exist AND
  // belong to the SAME class — otherwise a malicious client could wire a reply
  // preview to a message in a different class they don't have access to.
  let resolvedReplyToId: string | null = null;
  if (replyToId) {
    const repliedTo = await db.message.findUnique({
      where: { id: replyToId },
      select: { id: true, classId: true, deletedAt: true },
    });
    if (!repliedTo) {
      return NextResponse.json(
        { error: "پیام موردنظر برای پاسخ یافت نشد" },
        { status: 404 },
      );
    }
    if (repliedTo.classId !== classId) {
      return NextResponse.json(
        { error: "پیام موردنظر در این کلاس نیست" },
        { status: 400 },
      );
    }
    // Don't allow replying to a soft-deleted message — the UI hides it anyway,
    // but defence in depth: refuse so the replyTo preview can never point to a
    // tombstone row.
    if (repliedTo.deletedAt) {
      return NextResponse.json(
        { error: "امکان پاسخ به پیام حذفشده وجود ندارد" },
        { status: 400 },
      );
    }
    resolvedReplyToId = repliedTo.id;
  }

  // ---------------------------------------------------------------------------
  // Phase 19 — linked assignment / sample-question validation.
  // If the caller supplied a linked id, the linked row MUST exist. We DON'T
  // require the linked row to be in the SAME class as the target chat —
  // the "forward to chat" flow lets a teacher post a linked-assignment card
  // to ANY of their classes/groups (including ones different from the
  // assignment's home class), e.g. to share a section-A assignment with a
  // section-B chat. The displayed card only carries the assignment's title
  // + due date + fileUrl (no sensitive data); access to the target chat
  // itself is already enforced above (membership / principal / superadmin).
  //
  // SECURITY (cross-school link disclosure): the linked row's class must
  // still be accessible to the SENDER — for STUDENT senders it must be the
  // message's own class; for TEACHER/ADMIN senders it must be a class of
  // the sender's OWN school; SUPERADMIN is unscoped. Foreign ids are
  // IGNORED (treated as null) rather than rejected.
  // ---------------------------------------------------------------------------
  let resolvedLinkedAssignmentId: string | null = null;
  let resolvedLinkedSampleQuestionId: string | null = null;
  // Resolved linked rows (used to populate the response payload so the
  // optimistic append in the frontend matches the GET shape).
  let linkedAssignmentPayload: {
    id: string;
    title: string;
    dueDate: string | null;
    fileUrl: string | null;
    fileName: string | null;
  } | null = null;
  let linkedSampleQuestionPayload: {
    id: string;
    title: string;
    fileUrl: string | null;
    fileName: string | null;
  } | null = null;

  if (linkedAssignmentId) {
    const assignment = await db.assignment.findUnique({
      where: { id: linkedAssignmentId },
      select: {
        id: true,
        title: true,
        dueDate: true,
        fileUrl: true,
        fileName: true,
        classId: true,
        class: { select: { schoolId: true } },
      },
    });
    if (!assignment) {
      return NextResponse.json(
        { error: "تکلیف موردنظر یافت نشد" },
        { status: 404 },
      );
    }
    // SECURITY (school scoping): only attach the linked row when the
    // sender may access its class (see the section comment above) — a
    // foreign-school link is ignored (treated as null).
    const linkAllowed =
      user.role === "SUPERADMIN" ||
      (user.role === "STUDENT"
        ? assignment.classId === classId
        : !!user.schoolId &&
          (assignment.class?.schoolId ?? null) === user.schoolId);
    if (linkAllowed) {
      resolvedLinkedAssignmentId = assignment.id;
      linkedAssignmentPayload = {
        id: assignment.id,
        title: assignment.title,
        dueDate: assignment.dueDate
          ? assignment.dueDate.toISOString()
          : null,
        fileUrl: assignment.fileUrl,
        fileName: assignment.fileName,
      };
    }
  }

  if (linkedSampleQuestionId) {
    const question = await db.sampleQuestion.findUnique({
      where: { id: linkedSampleQuestionId },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        fileName: true,
        classId: true,
        class: { select: { schoolId: true } },
      },
    });
    if (!question) {
      return NextResponse.json(
        { error: "نمونه سوال موردنظر یافت نشد" },
        { status: 404 },
      );
    }
    // SECURITY (school scoping): only attach the linked row when the
    // sender may access its class (see the section comment above) — a
    // foreign-school link is ignored (treated as null).
    const linkAllowed =
      user.role === "SUPERADMIN" ||
      (user.role === "STUDENT"
        ? question.classId === classId
        : !!user.schoolId &&
          (question.class?.schoolId ?? null) === user.schoolId);
    if (linkAllowed) {
      resolvedLinkedSampleQuestionId = question.id;
      linkedSampleQuestionPayload = {
        id: question.id,
        title: question.title,
        fileUrl: question.fileUrl,
        fileName: question.fileName,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Persist message
  // ---------------------------------------------------------------------------
  const message = await db.message.create({
    data: {
      classId,
      senderId: user.id,
      content: hasText ? (content as string).trim() : "",
      replyToId: resolvedReplyToId,
      linkedAssignmentId: resolvedLinkedAssignmentId,
      linkedSampleQuestionId: resolvedLinkedSampleQuestionId,
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
      // Phase 19 — include the linked rows so the optimistic append in the
      // frontend matches the GET shape (the chat card needs the title +
      // dueDate + fileUrl from the linked assignment/question).
      linkedAssignment: {
        select: {
          id: true,
          title: true,
          dueDate: true,
          fileUrl: true,
          fileName: true,
        },
      },
      linkedSampleQuestion: {
        select: {
          id: true,
          title: true,
          fileUrl: true,
          fileName: true,
        },
      },
      // Count read receipts so the optimistic append matches the GET shape —
      // a brand-new message always has zero reads, but the field is there so
      // the frontend's union type lines up. Phase 18: count saves too.
      _count: { select: { reads: true, saves: true } },
    },
  });

  // Resolve the replyTo preview inline so the frontend can render the reply
  // header on the optimistic append without a second round-trip.
  let replyToPreview: {
    id: string;
    content: string;
    sender: { id: string; fullName: string; role: string };
  } | null = null;
  if (resolvedReplyToId) {
    const repliedTo = await db.message.findUnique({
      where: { id: resolvedReplyToId },
      select: {
        id: true,
        content: true,
        sender: { select: { id: true, fullName: true, role: true } },
      },
    });
    if (repliedTo) {
      replyToPreview = repliedTo;
    }
  }

  // Phase 22 — send push notification to all class members (except sender).
  // NOTE: this must run BEFORE the `return` below — previously it sat after
  // the return statement and therefore never executed (push silently never
  // fired). Behavior is otherwise identical; push failure is non-fatal.
  try {
    const members = await db.classMembership.findMany({
      where: { classId, userId: { not: user.id } },
      select: { userId: true },
    });
    const senderName = message.sender.fullName;
    for (const m of members) {
      await sendNotificationToUser(m.userId, {
        title: `💬 ${senderName}`,
        body: (content as string)?.trim()?.substring(0, 100) || "فایل پیوست",
        url: `/?classId=${classId}`,
        tag: "message",
      });
    }
  } catch { /* push failure is non-fatal */ }

  return NextResponse.json(
    {
      data: {
        id: message.id,
        classId: message.classId,
        senderId: message.senderId,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        isAnnouncement: message.isAnnouncement,
        // Phase-17 reply/forward/edit metadata.
        replyToId: message.replyToId,
        replyTo: replyToPreview,
        forwardedFromId: message.forwardedFromId,
        editedAt: message.editedAt ? message.editedAt.toISOString() : null,
        readCount: message._count.reads,
        // Phase 18 save metadata — a brand-new message is never saved by
        // anyone (savedCount=0) and the current user (sender) has not
        // saved it either (isSaved=false).
        isSaved: false,
        savedCount: message._count.saves,
        // Phase 19 — linked card metadata. Prefers the resolved payloads
        // (built from the validated input rows) but falls back to the joined
        // rows on the created Message for the case where the caller passed
        // BOTH a linked id AND content (in which case the joined row is the
        // source of truth). Both shapes are identical so the consumer can
        // treat them uniformly.
        linkedAssignmentId: message.linkedAssignmentId,
        linkedSampleQuestionId: message.linkedSampleQuestionId,
        linkedAssignment: linkedAssignmentPayload
          ?? (message.linkedAssignment
            ? {
                id: message.linkedAssignment.id,
                title: message.linkedAssignment.title,
                dueDate: message.linkedAssignment.dueDate
                  ? message.linkedAssignment.dueDate.toISOString()
                  : null,
                fileUrl: message.linkedAssignment.fileUrl,
                fileName: message.linkedAssignment.fileName,
              }
            : null),
        linkedSampleQuestion: linkedSampleQuestionPayload
          ?? (message.linkedSampleQuestion
            ? {
                id: message.linkedSampleQuestion.id,
                title: message.linkedSampleQuestion.title,
                fileUrl: message.linkedSampleQuestion.fileUrl,
                fileName: message.linkedSampleQuestion.fileName,
              }
            : null),
        deletedAt: message.deletedAt ? message.deletedAt.toISOString() : null,
        deletedById: message.deletedById,
        fileUrl: message.fileUrl,
        fileName: message.fileName,
        fileType: message.fileType,
        fileSize: message.fileSize,
        mimeType: message.mimeType,
        sender: message.sender,
      },
    },
    { status: 201 },
  );
});
