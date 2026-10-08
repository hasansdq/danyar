import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * AI assistant conversation history.
 *
 * Phase 21 — the AI panel now persists every (user, assistant) message pair
 * to the AIConversation table after each POST /api/ai-assistant call. This
 * route exposes the principal's own history (oldest-first for display) +
 * a DELETE that wipes their whole conversation.
 *
 *   GET    /api/ai-assistant/history       → { data: [{ id, role, content, actionJson, createdAt }] }
 *   DELETE /api/ai-assistant/history       → { data: { deleted: true } }
 *
 * Auth: any logged-in user reads/writes their OWN history only. The role
 * check (ADMIN/SUPERADMIN) lives in the POST /api/ai-assistant route; here
 * we don't gate by role because we want every authenticated user to be
 * able to manage their own AI chat log (the AI panel itself only renders
 * for admins, but the route is still safe — non-admins with no rows just
 * see an empty list).
 */
export const GET = apiHandler(async () => {
  const user = await requireAuth();

  // Most recent 50, then reverse so the chat list renders oldest-first
  // (top-to-bottom reading order) when the panel opens.
  const rows = await db.aIConversation.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      role: true,
      content: true,
      actionJson: true,
      createdAt: true,
    },
  });
  rows.reverse();

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      actionJson: r.actionJson,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

/**
 * DELETE /api/ai-assistant/history
 *
 * Wipes ALL AIConversation rows for the current user. Idempotent — returns
 * `{ data: { deleted: true } }` even when there were no rows to delete.
 *
 * The frontend calls this when the principal clicks the "پاک کردن تاریخچه"
 * button in the AI panel header.
 */
export const DELETE = apiHandler(async (_req: NextRequest) => {
  const user = await requireAuth();

  await db.aIConversation.deleteMany({
    where: { userId: user.id },
  });

  return NextResponse.json({ data: { deleted: true } });
});
