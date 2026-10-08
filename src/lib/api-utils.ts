import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  UnauthorizedError,
  ForbiddenError,
} from "@/lib/session";
import { PermissionDeniedError } from "@/lib/permission-check";
import { DmPermissionDeniedError } from "@/lib/dm-permissions";
import { ModuleDisabledError } from "@/lib/module-check";

/**
 * Wraps an async API route handler so that known auth errors thrown by
 * `requireAuth()` / `requireRole()` etc. are converted into clean JSON
 * responses (`401`, `403`) instead of bubbling up as 500s.
 *
 * Usage:
 *   export const GET = apiHandler(async (req, ctx) => { ... });
 *
 * The `context` argument exposes route params (e.g. `{ params: { id: "..." } }`).
 */
type Handler<TParams = Record<string, string | string[] | undefined>> = (
  req: NextRequest,
  ctx: { params: TParams },
) => Promise<NextResponse | Response> | NextResponse | Response;

// Next.js 16 route handlers receive `params` as a Promise. The wrapper
// resolves it before invoking the inner handler so call sites can keep
// destructuring plain objects (`const { id } = ctx.params` — wait-free at
// the type level because TParams defaults to `any`-compatible Records).
type NextCtx = { params: Promise<any> };

export function apiHandler<TParams = any>(
  handler: Handler<TParams>,
): (req: NextRequest, ctx: NextCtx) => Promise<NextResponse | Response> {
  return async (req: NextRequest, ctx: NextCtx) => {
    try {
      const params = ctx?.params ? await ctx.params : ({} as TParams);
      return await handler(req, { params });
    } catch (err: unknown) {
      // Prisma not-found errors (P2025) -> 404
      const code = (err as { code?: string })?.code;
      if (code === "P2025" || code === "P2026" || code === "NOT_FOUND") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      // Membership-related sentinel errors thrown by `requireMembership`.
      if (code === "FORBIDDEN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (err instanceof PermissionDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof DmPermissionDeniedError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      if (err instanceof ModuleDisabledError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      // Upload helpers throw plain `Error("FILE_TOO_LARGE" | "INVALID_EXTENSION" |
      // "INVALID_CONTENT" | "RATE_LIMITED")`.
      if (err instanceof Error) {
        if (err.message === "FILE_TOO_LARGE") {
          return NextResponse.json(
            { error: "فایل بزرگ‌تر از حد مجاز است" },
            { status: 413 },
          );
        }
        if (err.message === "INVALID_EXTENSION") {
          return NextResponse.json(
            { error: "نوع فایل مجاز نیست" },
            { status: 415 },
          );
        }
        if (err.message === "INVALID_CONTENT") {
          return NextResponse.json(
            { error: "محتوای فایل با پسوند آن مطابقت ندارد" },
            { status: 415 },
          );
        }
        if (err.message === "RATE_LIMITED") {
          return NextResponse.json(
            { error: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید." },
            { status: 429 },
          );
        }
        // Custom API bad-request errors with code BAD_REQUEST
        if ((err as any).status === 400 || err.message === "BAD_REQUEST") {
          return NextResponse.json(
            { error: (err as any).message ?? "Bad request" },
            { status: 400 },
          );
        }
        console.error("[apiHandler] internal error:", err);
        return NextResponse.json(
          { error: "Internal server error" },
          { status: 500 },
        );
      }
      console.error("[apiHandler] unknown error:", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}

/** Convenience for returning a `400` bad-request JSON response. */
export function badRequest(message = "Bad request") {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Convenience for returning a `404` not-found JSON response. */
export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** Throw a BAD_REQUEST marker error to be handled by `apiHandler`. */
export function throwBadRequest(message = "Bad request") {
  const err = new Error(message);
  (err as any).message = message;
  (err as any).status = 400;
  (err as any).code = "BAD_REQUEST";
  throw err;
}
