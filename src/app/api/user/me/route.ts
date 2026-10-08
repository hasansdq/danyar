import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/me
 *
 * Returns the currently-authenticated user's public profile, INCLUDING the
 * `avatar` field (which is NOT exposed by the NextAuth `/api/auth/session`
 * endpoint — that one only carries `{ id, role, username, name }` plus
 * `schoolId`).
 *
 * Used by the frontend profile UI / messenger header to render the avatar
 * bubble and the profile menu.
 *
 * Shape: `{ data: { id, username, fullName, role, avatar, avatarColor, schoolId } }`
 */
export const GET = apiHandler(async () => {
  const user = await requireAuth();

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      username: true,
      fullName: true,
      role: true,
      avatar: true,
      avatarColor: true,
      schoolId: true,
    },
  });

  if (!row) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    data: {
      id: row.id,
      username: row.username,
      fullName: row.fullName,
      role: row.role,
      avatar: row.avatar,
      avatarColor: row.avatarColor,
      schoolId: row.schoolId,
    },
  });
});
