/**
 * File-attachment helpers for the messenger chat.
 *
 * - `categorizeFile(file)`      → "image" | "pdf" | "video" | "file"
 * - `formatFileSize(bytes)`     → Persian "۸۰۰ کیلوبایت" / "۲٫۵ مگابایت"
 * - `formatFileTypesLabel(types)` → Persian list of allowed categories
 * - `categoryLabel(category)`   → singular Persian label
 *
 * These mirror the backend's `detectFileCategory` so client-side validation
 * shows the same category the server will compute.
 */
import type { FileCategory } from "./types";

const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

const IMAGE_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
]);
const PDF_EXT = new Set(["pdf"]);
const VIDEO_EXT = new Set([
  "mp4",
  "webm",
  "mov",
  "avi",
  "m4v",
  "mkv",
]);
const AUDIO_EXT = new Set([
  "mp3",
  "wav",
  "ogg",
  "oga",
  "opus",
  "m4a",
  "aac",
  "flac",
  "wma",
]);

const IMAGE_MIME = /^image\//i;
const PDF_MIME = /^application\/pdf/i;
const VIDEO_MIME = /^video\//i;
const AUDIO_MIME = /^audio\//i;

/**
 * Determine the file-category bucket ("image" | "pdf" | "video" | "audio" | "file") for
 * a user-selected File, preferring the MIME type and falling back to the file
 * extension. Mirrors the backend rule in `src/app/api/messages/route.ts`.
 */
export function categorizeFile(file: {
  type?: string;
  name?: string;
}): FileCategory {
  const mimeType = file.type || "";
  if (mimeType) {
    if (PDF_MIME.test(mimeType)) return "pdf";
    if (IMAGE_MIME.test(mimeType)) return "image";
    if (VIDEO_MIME.test(mimeType)) return "video";
    if (AUDIO_MIME.test(mimeType)) return "audio";
  }
  const ext = (file.name || "").split(".").pop()?.toLowerCase() ?? "";
  if (PDF_EXT.has(ext)) return "pdf";
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "file";
}

/**
 * Format a byte count into a human-readable Persian string.
 * - < 1 KB    → "<n> بایت"
 * - < 1 MB    → "<n> کیلوبایت"  (one decimal if non-round)
 * - < 1 GB    → "<n> مگابایت"
 * - else      → "<n> گیگابایت"
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "۰ بایت";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes < KB) {
    return `${toPersianDigits(bytes)} بایت`;
  }
  if (bytes < MB) {
    const kb = bytes / KB;
    const rounded = Math.round(kb * 10) / 10;
    const str = Number.isInteger(rounded)
      ? toPersianDigits(rounded)
      : toPersianDigits(rounded.toFixed(1).replace(".", "٫"));
    return `${str} کیلوبایت`;
  }
  if (bytes < GB) {
    const mb = bytes / MB;
    const rounded = Math.round(mb * 10) / 10;
    const str = Number.isInteger(rounded)
      ? toPersianDigits(rounded)
      : toPersianDigits(rounded.toFixed(1).replace(".", "٫"));
    return `${str} مگابایت`;
  }
  const gb = bytes / GB;
  const rounded = Math.round(gb * 100) / 100;
  const str = Number.isInteger(rounded)
    ? toPersianDigits(rounded)
    : toPersianDigits(rounded.toFixed(2).replace(".", "٫"));
  return `${str} گیگابایت`;
}

/** Singular Persian label for one file-category bucket. */
export function categoryLabel(category: FileCategory | string): string {
  switch (category) {
    case "image":
      return "تصویر";
    case "pdf":
      return "PDF";
    case "video":
      return "ویدئو";
    case "file":
      return "فایل";
    default:
      return category;
  }
}

/**
 * Comma-separated Persian list of allowed file categories, e.g.
 * `["image", "pdf"]` → `"تصویر، PDF"`. Returns `"همه"` if `null`/empty
 * (= all categories allowed by the class).
 */
export function formatFileTypesLabel(
  types: string[] | null | undefined,
): string {
  if (!types || types.length === 0) return "همه";
  return types.map(categoryLabel).join("، ");
}
