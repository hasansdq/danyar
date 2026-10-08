import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { saveFormDataFile } from "@/lib/upload";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BROADCAST_LEN = 2000;

// ---------------------------------------------------------------------------
// File-category helper (mirrors /api/messages route)
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
 * POST /api/teacher/broadcast
 *
 * Accepts EITHER:
 *   - application/json body: { content: string, classIds?: string[] }
 *   - multipart/form-data:    content (string), classIds (one or more),
 *                             file (optional File attachment)
 *
 * Creates a Message in each target class (sender = requester). When a file
 * is attached it is saved ONCE and every created message row references the
 * same file (so we don't duplicate the bytes on disk).
 *
 * Authorization / target selection:
 *   - If `classIds` is provided: broadcast to those classes.
 *     - TEACHER: only the classes they actually teach (others filtered
 *       silently).
 *     - ADMIN: only classes in their school (others filtered silently).
 *     - SUPERADMIN: unscoped.
 *   - If `classIds` is omitted:
 *     - TEACHER → all classes they teach.
 *     - ADMIN → all classes in their school.
 *     - SUPERADMIN → all classes.
 *
 * Validates content is non-empty and ≤ 2000 chars.
 * Permission gate: "bulk_chat_management" (no-op for SUPERADMIN).
 *
 * Returns { data: { count, classIds, messages: [{ id, classId }] } }.
 *
 * NOTE: This route ONLY persists messages. The socket.io chat-service emits
 * `new_message` per class as it detects the new row OR the frontend can
 * emit `relay_message` per created message.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "bulk_chat");

  await assertPermission(user.role, "bulk_chat_management");

  const contentType = req.headers.get("content-type") || "";

  let content: string | undefined;
  let requestedIds: string[] | undefined;
  let file: File | null = null;

  if (contentType.startsWith("multipart/form-data")) {
    // ---------------------------------------------------------------------
    // multipart/form-data path — text + optional file + classIds
    // ---------------------------------------------------------------------
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest("Invalid multipart body");
    }

    const contentVal = formData.get("content");
    if (contentVal !== null && typeof contentVal === "string") {
      content = contentVal;
    }

    // classIds may be submitted as multiple form fields named "classIds[]"
    // OR "classIds". Both .getAll() lookups cover both shapes.
    const classIdsVals = formData
      .getAll("classIds")
      .concat(formData.getAll("classIds[]"));
    if (classIdsVals.length > 0) {
      requestedIds = classIdsVals
        .map((v) => (typeof v === "string" ? v : ""))
        .filter((s) => s.length > 0);
    }

    const fileVal = formData.get("file");
    if (fileVal !== null && fileVal instanceof File) {
      file = fileVal;
    }
  } else {
    // ---------------------------------------------------------------------
    // JSON path — text-only (existing behaviour, preserved for backward
    // compatibility with the existing socket-driven bulk_broadcast flow).
    // ---------------------------------------------------------------------
    let body: any;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }
    content = body?.content;
    if (body?.classIds !== undefined) {
      if (!Array.isArray(body.classIds)) {
        return badRequest("classIds must be an array");
      }
      requestedIds = body.classIds
        .map((x: unknown) => (typeof x === "string" ? x : ""))
        .filter((s: string) => s.length > 0);
    }
  }

  // Validate content. A message needs EITHER non-empty text content OR a
  // file attachment.
  const hasText =
    typeof content === "string" && content.trim().length > 0;
  const hasFile = !!file && file.size > 0;
  if (!hasText && !hasFile) {
    return badRequest("content must be a non-empty string");
  }
  if (content && content.length > MAX_BROADCAST_LEN) {
    return badRequest(
      `content must be at most ${MAX_BROADCAST_LEN} characters`,
    );
  }
  const trimmedContent = hasText ? (content as string).trim() : "";

  // Permission gate: file uploads additionally require "file_upload".
  if (hasFile) {
    await assertPermission(user.role, "file_upload");
  }

  // ---------------------------------------------------------------------------
  // Determine target class IDs based on role + explicit classIds.
  // ---------------------------------------------------------------------------
  let targetClassIds: string[];
  if (user.role === "ADMIN" || user.role === "SUPERADMIN") {
    if (user.role === "ADMIN" && user.schoolId) {
      // Principal — restrict to their school.
      const schoolClasses = await db.classRoom.findMany({
        where: { schoolId: user.schoolId },
        select: { id: true },
      });
      const schoolIdSet = new Set(schoolClasses.map((c) => c.id));
      if (requestedIds && requestedIds.length > 0) {
        targetClassIds = requestedIds.filter((id) => schoolIdSet.has(id));
      } else {
        targetClassIds = Array.from(schoolIdSet);
      }
    } else {
      // SUPERADMIN (or principal without a school — defensive).
      if (requestedIds && requestedIds.length > 0) {
        targetClassIds = requestedIds;
      } else {
        const allClasses = await db.classRoom.findMany({ select: { id: true } });
        targetClassIds = allClasses.map((c) => c.id);
      }
    }
  } else {
    // TEACHER (or STUDENT — students have no classes they teach so they
    // will get count=0; reject explicit classIds they don't teach).
    const teacherMemberships = await db.classMembership.findMany({
      where: { userId: user.id, role: "TEACHER" },
      select: { classId: true },
    });
    const taughtIds = new Set(teacherMemberships.map((m) => m.classId));
    if (requestedIds && requestedIds.length > 0) {
      targetClassIds = requestedIds.filter((id) => taughtIds.has(id));
    } else {
      targetClassIds = Array.from(taughtIds);
    }
  }

  if (targetClassIds.length === 0) {
    return NextResponse.json({ data: { count: 0, classIds: [], messages: [] } });
  }

  // Verify all targets exist (defensive).
  const existing = await db.classRoom.findMany({
    where: { id: { in: targetClassIds } },
    select: { id: true },
  });
  const validIds = existing.map((c) => c.id);

  // ---------------------------------------------------------------------------
  // File handling — save the file ONCE and reuse the descriptor for every
  // created message (so we don't duplicate bytes on disk).
  // ---------------------------------------------------------------------------
  let fileUrl: string | null = null;
  let fileName: string | null = null;
  let fileType: string | null = null;
  let fileSize: number | null = null;
  let mimeType: string | null = null;

  if (file) {
    const saved = await saveFormDataFile(file, { actorId: user.id });
    if (!saved) {
      return NextResponse.json(
        { error: "پسوند این فایل پشتیبانی نمی‌شود" },
        { status: 415 },
      );
    }
    fileUrl = saved.fileUrl;
    fileName = saved.originalName;
    fileType = detectFileCategory(saved.mimeType, saved.originalName);
    fileSize = saved.fileSize;
    mimeType = saved.mimeType;
  }

  // Create one Message per class. SQLite Prisma doesn't support createMany
  // returning rows, so loop. Messenger scale is fine for now; for large
  // counts wrap in a transaction.
  const messages: { id: string; classId: string }[] = [];
  await db.$transaction(async (tx) => {
    for (const classId of validIds) {
      const msg = await tx.message.create({
        data: {
          classId,
          senderId: user.id,
          content: trimmedContent,
          fileUrl,
          fileName,
          fileType,
          fileSize,
          mimeType,
        },
        select: { id: true, classId: true },
      });
      messages.push({ id: msg.id, classId: msg.classId });
    }
  });

  return NextResponse.json({
    data: {
      count: messages.length,
      classIds: messages.map((m) => m.classId),
      messages,
    },
  });
});
