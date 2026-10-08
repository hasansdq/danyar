import { db } from "@/lib/db";
import { getClientIp } from "@/lib/rate-limit";

/**
 * Audit logging for sensitive operations.
 *
 * SECURITY RULES:
 *  - NEVER log passwords, OTP codes, tokens, or API keys — `meta` passes
 *    through a redaction step that strips well-known secret-ish keys, and
 *    callers must only pass non-secret metadata.
 *  - Audit writes are best-effort: an audit failure must NEVER break the
 *    user-facing operation (errors are swallowed + printed to server logs).
 */

const SECRET_KEY_PATTERN = /(password|passwd|secret|token|otp|apikey|api_key|credential|authorization|cookie)/i;
const MAX_META_LENGTH = 4000;
const MAX_STRING_VALUE = 500;

/** Recursively redact secret-ish keys + bound value lengths. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING_VALUE ? value.slice(0, MAX_STRING_VALUE) + "…" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export interface AuditInput {
  /** Authenticated actor (omit for anonymous events such as failed logins). */
  actor?: { id: string; username: string; role: string; schoolId?: string | null } | null;
  /** Anonymous actor username (failed-login target), when there is no session. */
  actorUsername?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Request (for IP + user-agent extraction). */
  req?: Request;
  /** Non-secret metadata. */
  meta?: Record<string, unknown>;
}

/** Write an audit entry. Best-effort — never throws. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    let metaStr: string | null = null;
    if (input.meta !== undefined) {
      const redacted = JSON.stringify(redact(input.meta));
      metaStr = redacted.length > MAX_META_LENGTH ? redacted.slice(0, MAX_META_LENGTH) + "…" : redacted;
    }
    await db.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        actorUsername: input.actor?.username ?? input.actorUsername ?? null,
        actorRole: input.actor?.role ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ip: input.req ? getClientIp(input.req) : null,
        userAgent: input.req ? (input.req.headers.get("user-agent") ?? "").slice(0, 500) : null,
        schoolId: input.actor?.schoolId ?? null,
        metadata: metaStr,
      },
    });
  } catch (err) {
    // Audit failure must not break the main operation.
    console.error("[audit] failed to write audit log:", err instanceof Error ? err.message : err);
  }
}

/** Well-known action names (keep consistent across call sites). */
export const AuditActions = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGIN_LOCKOUT: "LOGIN_LOCKOUT",
  OTP_REQUEST: "OTP_REQUEST",
  OTP_LOGIN_SUCCESS: "OTP_LOGIN_SUCCESS",
  IMPERSONATE: "IMPERSONATE",
  USER_CREATE: "USER_CREATE",
  USER_UPDATE: "USER_UPDATE",
  USER_DELETE: "USER_DELETE",
  USER_BULK_CREATE: "USER_BULK_CREATE",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  PASSWORD_RESET: "PASSWORD_RESET",
  ROLE_CHANGE: "ROLE_CHANGE",
  SCHOOL_CREATE: "SCHOOL_CREATE",
  SCHOOL_UPDATE: "SCHOOL_UPDATE",
  SCHOOL_DELETE: "SCHOOL_DELETE",
  PERMISSION_RESET: "PERMISSION_RESET",
  SETTINGS_UPDATE: "SETTINGS_UPDATE",
  LOGIN_SETTINGS_UPDATE: "LOGIN_SETTINGS_UPDATE",
  AI_SETTINGS_UPDATE: "AI_SETTINGS_UPDATE",
  OTP_SETTINGS_UPDATE: "OTP_SETTINGS_UPDATE",
  OTP_TEST_SEND: "OTP_TEST_SEND",
  PUSH_BROADCAST: "PUSH_BROADCAST",
  CLASSROOM_END: "CLASSROOM_END",
  BULK_OPERATION: "BULK_OPERATION",
} as const;
