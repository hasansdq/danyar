import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/search?q=<name>&limit=20
 *
 * Search users by `fullName` (case-insensitive contains) or `username`
 * (case-insensitive contains). Excludes the requester themselves.
 *
 * Scoping:
 *  - STUDENT / TEACHER / ADMIN → only users in the SAME school
 *    (`schoolId === user.schoolId`), excluding self.
 *  - SUPERADMIN → all users.
 *
 * Returns: `{ data: [{ id, fullName, username, role, avatar, schoolId }] }`
 * sorted by `fullName` ascending. Limit default 20, max 50.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  const qRaw = req.nextUrl.searchParams.get("q") ?? "";
  const q = qRaw.trim();
  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = Math.max(1, Math.min(50, Number(limitRaw) || 20));

  // Build the where-clause. SQLite's Prisma client does NOT support
  // `mode: "insensitive"` for `contains`, so we use plain `contains` (which
  // SQLite maps to a case-insensitive LIKE for ASCII; Persian text has no
  // case distinction, so this works fine for our purposes).
  const where: {
    id: { not: string };
    schoolId?: string | null;
    OR?: Array<
      { fullName: { contains: string } } |
      { username: { contains: string } }
    >;
  } = {
    id: { not: user.id },
  };

  if (user.role !== "SUPERADMIN") {
    // Same-school only. If the requester has no schoolId, fall back to
    // matching users whose schoolId is null too (i.e. legacy users only).
    if (user.schoolId) {
      where.schoolId = user.schoolId;
    } else {
      where.schoolId = null;
    }
  }

  if (q.length > 0) {
    where.OR = [
      { fullName: { contains: q } },
      { username: { contains: q } },
    ];
  }

  const rows = await db.user.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      username: true,
      role: true,
      avatar: true,
      schoolId: true,
    },
    orderBy: { fullName: "asc" },
    take: limit,
  });

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      username: r.username,
      role: r.role,
      avatar: r.avatar,
      schoolId: r.schoolId,
    })),
  });
});
