import { NextResponse, type NextRequest } from "next/server";
import path from "path";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertModule } from "@/lib/module-check";
import { saveFormDataFile } from "@/lib/upload";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Only image uploads are accepted as profile pictures.
const ALLOWED_AVATAR_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);
const ALLOWED_AVATAR_MIME = /^image\/(png|jpe?g|gif|webp)$/i;

/**
 * POST /api/user/avatar
 *
 * multipart/form-data with a single `file` field that MUST be an image
 * (png/jpg/jpeg/gif/webp). Saves the file under /public/uploads and stores
 * the public URL on `User.avatar`.
 *
 * Returns `{ data: { id, avatar } }` with 200 on success. Errors:
 *   - 400 — missing file field
 *   - 415 — non-image upload (Persian message)
 *   - 413 — file too large (from saveFormDataFile)
 *   - 401 — unauthenticated (from requireAuth via apiHandler)
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "profile_avatar");

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

  // Strict image-only validation: check both the extension AND the MIME type
  // (whichever the client provided). If either clearly indicates a non-image
  // upload, reject with 415 "فقط تصویر مجاز است". saveFormDataFile would also
  // reject disallowed extensions, but its allow-list is much broader (PDFs,
  // zips, videos…). For avatars we want ONLY images.
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

  // If the file lacks an extension entirely, fall back to MIME-based check.
  if (!ext && !mimeOk) {
    return NextResponse.json(
      { error: "فقط تصویر مجاز است" },
      { status: 415 },
    );
  }

  // saveFormDataFile throws FILE_TOO_LARGE / INVALID_EXTENSION for oversize or
  // disallowed extensions — apiHandler maps those to 413 / 415 responses.
  const saved = await saveFormDataFile(fileVal, { actorId: user.id });
  if (!saved) {
    return NextResponse.json(
      { error: "فقط تصویر مجاز است" },
      { status: 415 },
    );
  }

  // Defensive: the saved file's extension must be one of our avatar extensions.
  // If somehow the broad allow-list admitted a non-image (e.g. a .svg), reject.
  const savedExt = path.extname(saved.fileName).toLowerCase().replace(/^\./, "");
  if (!ALLOWED_AVATAR_EXTS.has(savedExt)) {
    return NextResponse.json(
      { error: "فقط تصویر مجاز است" },
      { status: 415 },
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: { avatar: saved.fileUrl },
  });

  return NextResponse.json({
    data: {
      id: user.id,
      avatar: saved.fileUrl,
    },
  });
});

/**
 * DELETE /api/user/avatar
 *
 * Clears the current user's avatar (`avatar = null`). Returns
 * `{ data: { id, avatar: null } }`.
 */
export const DELETE = apiHandler(async () => {
  const user = await requireAuth();

  await db.user.update({
    where: { id: user.id },
    data: { avatar: null },
  });

  return NextResponse.json({
    data: {
      id: user.id,
      avatar: null,
    },
  });
});
