import { randomUUID } from "crypto";
import path from "path";
import fs, { mkdir } from "fs/promises";
import { rateLimit } from "@/lib/rate-limit";

// Phase 36m — configurable upload directory via env var.
// Default: public/uploads (served by Next.js static).
// In Docker: UPLOAD_DIR=/data/uploads (persistent volume, symlinked
// from public/uploads by the entrypoint script).
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? (process.env.UPLOAD_DIR.startsWith("/") ? process.env.UPLOAD_DIR : path.join(process.cwd(), process.env.UPLOAD_DIR))
  : path.join(process.cwd(), "public", "uploads");
const PUBLIC_URL_PREFIX = "/uploads";

// ---------------------------------------------------------------------------
// SECURITY — allowed file types
//
// Validation is layered:
//   1. extension allowlist (below) — no SVG (stored XSS), no executables,
//      no server-side scriptable formats (html/htm/xhtml/svg).
//   2. magic-byte signature check (detectFileType) — the actual content must
//      match the extension's expected family. Extension/MIME alone is
//      attacker-controlled (curl lets you set both).
//   3. declared MIME type consistency check (when the client sends one).
//
// Archives (zip/rar/7z/gz/tar) are stored as opaque blobs — the app NEVER
// extracts them server-side, so zip-bomb/path-traversal-via-extraction does
// not apply. If extraction is ever added, it MUST use a hardened lib with
// entry-name validation + size/count caps.
// ---------------------------------------------------------------------------
const ALLOWED_EXTENSIONS = new Set([
  // documents
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "txt", "rtf",
  // images (NO svg — stored XSS vector when opened directly)
  "png", "jpg", "jpeg", "gif", "webp", "bmp",
  // archives (stored only — never extracted)
  "zip", "rar", "7z", "gz", "tar",
  // audio / video
  "mp3", "mp4", "wav", "mov", "avi", "webm", "m4a",
]);

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

// Per-user upload rate limit: 30 files / 10 minutes.
const UPLOAD_RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

export type UploadedFile = {
  /** Original file name from the client, sanitized (control chars removed). */
  originalName: string;
  /** Public URL path that can be stored in DB and served to clients */
  fileUrl: string;
  /** Final stored file name */
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  /** MIME type if known */
  mimeType: string;
};

function sanitizeExtension(name: string): string | null {
  const ext = path.extname(name).toLowerCase().replace(/^\./, "");
  if (!ext) return null;
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  return ext;
}

/** Strip control chars + bound length of client-supplied filenames. */
function sanitizeOriginalName(name: string): string {
  return (
    name
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/]/g, "_")
      .slice(0, 255) || "upload.bin"
  );
}

// ---------------------------------------------------------------------------
// Magic-byte sniffing
// ---------------------------------------------------------------------------

type FileFamily =
  | "image"
  | "pdf"
  | "archive"
  | "ole" // legacy MS Office (doc/xls/ppt)
  | "ooxml" // modern MS Office (docx/xlsx/pptx) + ODF — ZIP containers
  | "audio"
  | "video"
  | "text"
  | null;

/** Map each allowed extension to the acceptable content families. */
const EXT_FAMILY: Record<string, FileFamily[]> = {
  png: ["image"],
  jpg: ["image"],
  jpeg: ["image"],
  gif: ["image"],
  webp: ["image"],
  bmp: ["image"],
  pdf: ["pdf"],
  zip: ["archive"],
  rar: ["archive"],
  "7z": ["archive"],
  gz: ["archive"],
  tar: ["archive"],
  doc: ["ole"],
  xls: ["ole"],
  ppt: ["ole"],
  docx: ["ooxml"],
  xlsx: ["ooxml"],
  pptx: ["ooxml"],
  odt: ["ooxml"],
  ods: ["ooxml"],
  odp: ["ooxml"],
  mp3: ["audio"],
  wav: ["audio"],
  m4a: ["audio"],
  mp4: ["video"],
  webm: ["video"],
  mov: ["video"],
  avi: ["video"],
  txt: ["text"],
  rtf: ["text"],
};

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function asciiAt(buf: Buffer, offset: number, len: number): string {
  return buf.slice(offset, offset + len).toString("latin1");
}

/**
 * Content-based type detection. Returns the detected family or null when the
 * signature is unknown. `text` is a heuristic (no NUL bytes + printable-ish
 * in the first 512 bytes) used for txt/rtf.
 */
function detectFileFamily(buf: Buffer): FileFamily {
  if (buf.length === 0) return null;
  // Images
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return "image"; // PNG
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image"; // JPEG
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return "image"; // GIF
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && asciiAt(buf, 8, 4) === "WEBP") return "image"; // RIFF....WEBP
  if (startsWith(buf, [0x42, 0x4d])) return "image"; // BMP
  // PDF
  if (asciiAt(buf, 0, 5) === "%PDF-") return "pdf";
  // Archives
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) || startsWith(buf, [0x50, 0x4b, 0x07, 0x08])) {
    // ZIP — could be plain archive OR OOXML/ODF container. Distinguish by
    // looking for known internal filenames ([Content_Types].xml / mimetype).
    const head = buf.slice(0, Math.min(buf.length, 4096)).toString("latin1");
    if (head.includes("[Content_Types].xml") || head.includes("mimetype")) return "ooxml";
    return "archive";
  }
  if (asciiAt(buf, 0, 6) === "Rar!\u001a\u0007") return "archive"; // RAR
  if (startsWith(buf, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "archive"; // 7z
  if (startsWith(buf, [0x1f, 0x8b])) return "archive"; // GZIP
  if (asciiAt(buf, 257, 5) === "ustar") return "archive"; // TAR
  // Legacy MS Office (OLE2 compound document)
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
  // Audio
  if (asciiAt(buf, 0, 3) === "ID3") return "audio"; // MP3 w/ ID3
  if (startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3]) || startsWith(buf, [0xff, 0xf2])) return "audio"; // raw MPEG audio
  if (asciiAt(buf, 0, 4) === "RIFF" && asciiAt(buf, 8, 4) === "WAVE") return "audio"; // WAV
  if (asciiAt(buf, 4, 4) === "ftyp" && asciiAt(buf, 8, 4).startsWith("M4A")) return "audio"; // M4A
  // Video / EBML containers
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "video"; // EBML (webm/mkv)
  if (asciiAt(buf, 4, 4) === "ftyp") return "video"; // MP4/MOV (isom, mp42, qt ...)
  if (asciiAt(buf, 0, 4) === "RIFF" && asciiAt(buf, 8, 4) === "AVI ") return "video"; // AVI
  // Text-ish (txt/rtf) — heuristic
  const probe = buf.slice(0, Math.min(buf.length, 512));
  if (!probe.includes(0)) {
    if (asciiAt(buf, 0, 5) === "{\\rtf") return "text"; // RTF
    // Reject anything that looks like HTML/script with a .txt extension.
    const head = probe.toString("utf8").trimStart().toLowerCase();
    if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml") || head.startsWith("<script")) {
      return null;
    }
    return "text";
  }
  return null;
}

/** Loose MIME → family mapping for the declared-type consistency check. */
function mimeToFamily(mime: string): FileFamily {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m === "application/zip" || m === "application/x-zip-compressed" || m === "application/x-7z-compressed" || m === "application/x-rar-compressed" || m === "application/gzip" || m === "application/x-tar") return "archive";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || m === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || m === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || m.startsWith("application/vnd.oasis.opendocument")) return "ooxml";
  if (m === "application/msword" || m === "application/vnd.ms-excel" || m === "application/vnd.ms-powerpoint") return "ole";
  if (m.startsWith("text/")) return "text";
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SaveFileOptions {
  /** Authenticated uploader id — enables the per-user upload rate limit. */
  actorId?: string;
}

/**
 * Saves a File (Blob) coming from a NextRequest FormData into
 * `<UPLOAD_DIR>/<unique>.<ext>` and returns a descriptor including the
 * public URL path `/uploads/<unique>.<ext>`.
 *
 * Validation performed (in order):
 *   0. per-user rate limit (30 uploads / 10 min) when actorId is given
 *   1. non-empty + size cap (25 MB)
 *   2. extension allowlist (no svg/html/executables)
 *   3. magic-byte family must match the extension family
 *   4. declared MIME (when present) must be consistent with the above
 *
 * Throws Error("RATE_LIMITED" | "FILE_TOO_LARGE" | "INVALID_EXTENSION" |
 * "INVALID_CONTENT") — mapped to HTTP statuses by apiHandler / call sites.
 */
export async function saveFormDataFile(
  file: File | null | undefined,
  opts: SaveFileOptions = {},
): Promise<UploadedFile | null> {
  if (!file) return null;

  // File.size of 0 means empty upload — treat as "no file".
  if (file.size === 0) return null;
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  // Per-user rate limit.
  if (opts.actorId) {
    const rl = rateLimit(`upload:${opts.actorId}`, UPLOAD_RATE_LIMIT);
    if (!rl.ok) {
      throw new Error("RATE_LIMITED");
    }
  }

  const originalName = sanitizeOriginalName(file.name || "upload.bin");
  const ext = sanitizeExtension(file.name || "");
  if (!ext) {
    throw new Error("INVALID_EXTENSION");
  }

  // Read the content ONCE (≤ 25 MB) — validate bytes before anything is
  // written to disk.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Magic-byte validation: detected family must be acceptable for ext.
  const allowedFamilies = EXT_FAMILY[ext] ?? [];
  const detected = detectFileFamily(buffer);
  if (detected === null || !allowedFamilies.includes(detected)) {
    throw new Error("INVALID_CONTENT");
  }

  // Declared-MIME consistency (when the client sent one).
  const declaredMime = (file.type || "").trim();
  if (declaredMime) {
    const declaredFamily = mimeToFamily(declaredMime);
    if (declaredFamily !== null && detected !== null && declaredFamily !== detected) {
      throw new Error("INVALID_CONTENT");
    }
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  const uniqueName = `${Date.now()}-${randomUUID()}.${ext}`;
  const fullPath = path.join(UPLOAD_DIR, uniqueName);

  // Write to a hidden temp file first, then atomically rename so partial
  // files are never visible/served to clients.
  const tmpPath = path.join(UPLOAD_DIR, `.${uniqueName}.tmp`);
  await fs.writeFile(tmpPath, buffer, { flag: "w" });
  await fs.rename(tmpPath, fullPath);

  return {
    originalName,
    fileUrl: `${PUBLIC_URL_PREFIX}/${uniqueName}`,
    fileName: uniqueName,
    fileSize: buffer.length,
    mimeType: declaredMime || guessMimeFromExt(ext),
  };
}

function guessMimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    pdf: "application/pdf",
    txt: "text/plain",
    rtf: "application/rtf",
    zip: "application/zip",
    rar: "application/vnd.rar",
    "7z": "application/x-7z-compressed",
    gz: "application/gzip",
    tar: "application/x-tar",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
  };
  return map[ext] ?? "application/octet-stream";
}

/**
 * Best-effort helper that takes raw text fields from FormData, returns them as
 * strings. Useful for multipart endpoints that mix text + file.
 */
export function getField(
  formData: FormData,
  key: string,
): string | undefined {
  const value = formData.get(key);
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  // File — not expected for plain text fields.
  return undefined;
}

export { MAX_FILE_BYTES, ALLOWED_EXTENSIONS };
