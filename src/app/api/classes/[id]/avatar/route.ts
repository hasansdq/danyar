import { NextResponse, type NextRequest } from "next/server";
import path from "path";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { saveFormDataFile } from "@/lib/upload";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Only image uploads are accepted as group profile pictures.
const ALLOWED_AVATAR_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);
const ALLOWED_AVATAR_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

/**
 * Authorization helper: returns true if the current user is allowed to edit
 * the avatar of the class identified by `id`. Same rules as PATCH
 * /api/classes/[id]/info: isTeacherOf(classId) OR ADMIN principal of the
 * school OR SUPERADMIN.
 */
async function canEditClassAvatar(
  user: { id: string; role: string; schoolId?: string | null },
  id: string,
): Promise<boolean> {
  const cls = await db.classRoom.findUnique({
    where: { id },
    select: { schoolId: true },
  });
  if (!cls) return false;

  if (user.role === "SUPERADMIN") return true;
  if (
    user.role === "ADMIN" &&
    !!user.schoolId &&
    cls.schoolId === user.schoolId
  ) {
    return true;
  }
  const membership = await verifyMembership(user.id, id);
  return !!membership && membership.role === "TEACHER";
}

/**
 * POST /api/classes/[id]/avatar
 *
 * multipart/form-data with a single `file` field that MUST be an image
 * (png/jpg/jpeg/gif/webp). Saves the file under /public/uploads and stores
 * the public URL on `ClassRoom.avatar` (group profile picture).
 *
 * Auth: isTeacherOf(classId) OR ADMIN principal of the school OR SUPERADMIN.
 *
 * Returns `{ data: { id, avatar } }` with 200 on success. Errors:
 *   - 400 — missing file field
 *   - 415 — non-image upload (Persian message)
 *   - 413 — file too large (from saveFormDataFile)
 *   - 401 — unauthenticated (from requireAuth via apiHandler)
 *   - 403 — not authorized to edit this group's avatar
 *   - 404 — class not found
 */
export const POST = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return badRequest("شناسه کلاس الزامی است");

    const existing = await db.classRoom.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "کلاس یافت نشد" },
        { status: 404 },
      );
    }

    const canEdit = await canEditClassAvatar(user, id);
    if (!canEdit) {
      return NextResponse.json(
        { error: "شما اجازه ویرایش تصویر این گروه را ندارید" },
        { status: 403 },
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return badRequest("Invalid multipart body");
    }

    const fileVal = formData.get("file");
    if (!fileVal || !(fileVal instanceof File) || fileVal.size === 0) {
      return badRequest("فایل تصویر ارسال نشده است");
    }

    // Strict image-only validation: check both the extension AND the MIME
    // type. saveFormDataFile has a broader allow-list (PDFs, zips, videos…)
    // — for avatars we want ONLY images.
    const ext = path.extname(fileVal.name || "").toLowerCase().replace(/^\./, "");
    const mime = (fileVal.type || "").toLowerCase();
    const extOk = !ext || ALLOWED_AVATAR_EXTS.has(ext);
    const mimeOk = !mime || ALLOWED_AVATAR_MIME.test(mime);
    if (!extOk || !mimeOk) {
      return NextResponse.json(
        { error: "فقط تصویر مجاز است" },
        { status: 415 },
      );
    }
    if (!ext && !mimeOk) {
      return NextResponse.json(
        { error: "فقط تصویر مجاز است" },
        { status: 415 },
      );
    }

    // saveFormDataFile throws FILE_TOO_LARGE / INVALID_EXTENSION for oversize
    // or disallowed extensions — apiHandler maps those to 413 / 415.
    const saved = await saveFormDataFile(fileVal, { actorId: user.id });
    if (!saved) {
      return NextResponse.json(
        { error: "فقط تصویر مجاز است" },
        { status: 415 },
      );
    }

    // Defensive: the saved file's extension must be one of our avatar
    // extensions. If somehow the broad allow-list admitted a non-image,
    // reject so we never store a non-image as the group avatar.
    const savedExt = path.extname(saved.fileName).toLowerCase().replace(/^\./, "");
    if (!ALLOWED_AVATAR_EXTS.has(savedExt)) {
      return NextResponse.json(
        { error: "فقط تصویر مجاز است" },
        { status: 415 },
      );
    }

    await db.classRoom.update({
      where: { id },
      data: { avatar: saved.fileUrl },
    });

    return NextResponse.json({
      data: {
        id,
        avatar: saved.fileUrl,
      },
    });
  },
);

/**
 * DELETE /api/classes/[id]/avatar
 *
 * Clears the group's avatar (`avatar = null`). Returns
 * `{ data: { id, avatar: null } }`.
 *
 * Auth: isTeacherOf(classId) OR ADMIN principal of the school OR SUPERADMIN.
 */
export const DELETE = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;
    if (!id) return badRequest("شناسه کلاس الزامی است");

    const existing = await db.classRoom.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "کلاس یافت نشد" },
        { status: 404 },
      );
    }

    const canEdit = await canEditClassAvatar(user, id);
    if (!canEdit) {
      return NextResponse.json(
        { error: "شما اجازه ویرایش تصویر این گروه را ندارید" },
        { status: 403 },
      );
    }

    await db.classRoom.update({
      where: { id },
      data: { avatar: null },
    });

    return NextResponse.json({
      data: {
        id,
        avatar: null,
      },
    });
  },
);
