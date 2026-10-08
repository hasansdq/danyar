/**
 * Shared helpers for per-class file-upload settings.
 *
 * The `allowedFileTypes` field on ClassRoom is stored as a JSON-encoded
 * string (SQLite has no native list type). These helpers parse/validate the
 * value on the way in and out of the API surface so route handlers stay clean.
 */

export const FILE_TYPE_CATEGORIES = [
  "image",
  "pdf",
  "video",
  "file",
] as const;

export type FileTypeCategory = (typeof FILE_TYPE_CATEGORIES)[number];

export type AllowedFileTypes = FileTypeCategory[] | null;

const VALID_CATEGORY_SET = new Set<string>(FILE_TYPE_CATEGORIES);

/**
 * True if `value` is an array of strings, each being one of
 * "image" | "pdf" | "video" | "file".
 */
export function isValidAllowedFileTypes(value: unknown): value is FileTypeCategory[] {
  if (!Array.isArray(value)) return false;
  return value.every((v) => typeof v === "string" && VALID_CATEGORY_SET.has(v));
}

/**
 * Parses the JSON-encoded `allowedFileTypes` string from the ClassRoom table
 * into an array (or null when the class allows all types).
 *
 * null/empty/malformed → null = "all types allowed".
 */
export function parseAllowedFileTypes(
  raw: string | null | undefined,
): AllowedFileTypes {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // The guard already checks membership in VALID_CATEGORY_SET, so the
      // predicate can safely narrow to FileTypeCategory.
      const filtered = parsed.filter(
        (x): x is FileTypeCategory => typeof x === "string" && VALID_CATEGORY_SET.has(x),
      );
      return filtered.length > 0 ? filtered : null;
    }
  } catch {
    // ignore malformed JSON — treat as "all allowed"
  }
  return null;
}

/**
 * Serializes an array of file-type categories into the JSON-encoded string
 * stored in the ClassRoom table. Empty array or null → null (all allowed).
 */
export function serializeAllowedFileTypes(
  value: AllowedFileTypes,
): string | null {
  if (!value || value.length === 0) return null;
  return JSON.stringify(value);
}
