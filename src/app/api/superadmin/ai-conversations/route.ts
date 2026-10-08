import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/ai-conversations?userId=<id>&limit=100
 *
 * Phase 21 — SUPERADMIN-only viewer of all principals' AI-assistant chat
 * history. The principal's chat panel persists every (user, assistant)
 * message pair to the AIConversation table; this route lets the SUPERADMIN
 * audit who's been using the assistant + what they asked it.
 *
 * Two modes:
 *   1. No `userId` query — returns a flat list of every user that has at
 *      least one AIConversation row, with the total message count + the
 *      most-recent message timestamp. The SUPERADMIN UI renders this as
 *      a searchable table; clicking a row switches to mode 2.
 *   2. `userId=<id>` query — returns that user's conversation (oldest-first
 *      for top-to-bottom display), capped by `limit` (default 100).
 *
 * Auth: `requireSuperAdminApi()`.
 *
 * Return shapes:
 *   mode 1 → { data: [{ userId, fullName, username, role, messageCount, lastMessageAt }] }
 *   mode 2 → { data: [{ id, role, content, actionJson, createdAt }] }
 */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const userIdParam = url.searchParams.get("userId")?.trim() || undefined;
  const limitParam = parseInt(
    url.searchParams.get("limit") || "100",
    10,
  );
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitParam) ? limitParam : 100));

  // ---- Mode 2 — specific user's conversation history ------------------
  if (userIdParam) {
    // Make sure the user exists (defensive — a tampered UI could send a
    // random id; we just return an empty list in that case).
    const target = await db.user.findUnique({
      where: { id: userIdParam },
      select: { id: true, fullName: true, username: true, role: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "کاربر یافت نشد" },
        { status: 404 },
      );
    }

    // Most recent `limit`, then reverse so oldest comes first.
    const rows = await db.aIConversation.findMany({
      where: { userId: userIdParam },
      orderBy: { createdAt: "desc" },
      take: limit,
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
  }

  // ---- Mode 1 — list of users with AI conversations -------------------
  // Group by user via a Prisma `groupBy` (counts + max createdAt per user)
  // then hydrate the user fields with a second findMany. SQLite is fine
  // with this — the table is small (one row per chat turn per principal).
  const grouped = await db.aIConversation.groupBy({
    by: ["userId"],
    where: {},
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
  });

  if (grouped.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const userIds = grouped.map((g) => g.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, fullName: true, username: true, role: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Preserve the grouped order (most recent first) — fall back to user
  // records that might have been deleted.
  const data = grouped.map((g) => {
    const u = userMap.get(g.userId);
    return {
      userId: g.userId,
      fullName: u?.fullName ?? "—",
      username: u?.username ?? "—",
      role: u?.role ?? "—",
      messageCount: g._count._all,
      lastMessageAt: g._max.createdAt
        ? g._max.createdAt.toISOString()
        : null,
    };
  });

  return NextResponse.json({ data });
}
