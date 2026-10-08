import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/classes/[id]/students
 *
 * Lists all STUDENT members of the class with `{ id, fullName, username,
 * avatarColor }`. Available to ANY member of the class (any role).
 *
 * Used by the teacher grades view to populate the full student roster
 * (e.g., for bulk grade entry).
 *
 * Sorted by fullName ascending (Persian locale).
 */
export const GET = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    const { id } = await ctx.params;

    // Verify the requester is a member (any role) of the class.
    // Admins who are not members still get read access.
    const membership = await verifyMembership(user.id, id);
    if (!membership && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cls = await db.classRoom.findUnique({
      where: { id },
      select: {
        id: true,
        schoolId: true,
        memberships: {
          where: { role: "STUDENT" },
          select: {
            user: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatarColor: true,
              },
            },
          },
        },
      },
    });

    if (!cls) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }

    // SECURITY (school scoping): an ADMIN (principal) without membership
    // may only list students of classes in their OWN school.
    if (
      !membership &&
      user.role === "ADMIN" &&
      (!user.schoolId || cls.schoolId !== user.schoolId)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const data = cls.memberships
      .map((m) => ({
        id: m.user.id,
        fullName: m.user.fullName,
        username: m.user.username,
        avatarColor: m.user.avatarColor,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "fa"));

    return NextResponse.json({ data });
  },
);
