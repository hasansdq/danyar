import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, notFound } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/messages/[id]/readers
 *
 * Returns the list of users who have seen (have a MessageRead row for) the
 * message identified by [id]. Each reader carries `{ id, userId, fullName,
 * username, role, avatar, readAt }` so the UI can render the "seen-by" sheet.
 *
 * Permission: the requester must be a member of the message's class — OR a
 * principal (ADMIN) of the school that owns the class — OR a SUPERADMIN.
 * Read receipts are only meaningful to peers in the same class; outsiders
 * can't enumerate who-saw-what.
 *
 * Body: none (GET). Returns `{ data: [{ id, userId, fullName, username,
 * role, avatar, readAt }] }` ordered by `readAt asc` (first-to-see first).
 */
export const GET = apiHandler<{ id: string }>(
  async (_req: NextRequest, ctx) => {
    const user = await requireAuth();
    await assertModule(user.role, "class_chat");
    const { id } = await ctx.params;
    if (!id) return notFound("شناسه پیام الزامی است");

    // Load the message so we know which class it belongs to.
    const message = await db.message.findUnique({
      where: { id },
      select: { id: true, classId: true },
    });
    if (!message) {
      return notFound("پیام یافت نشد");
    }

    // Access control: member of the class OR principal of the school OR
    // SUPERADMIN.
    const membership = await verifyMembership(user.id, message.classId);
    const cls = await db.classRoom.findUnique({
      where: { id: message.classId },
      select: { schoolId: true },
    });
    const isPrincipalOfClass =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      cls?.schoolId === user.schoolId;
    const isSuperAdmin = user.role === "SUPERADMIN";

    if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Load all MessageRead rows for this message, joined with the user so
    // the UI can render the avatar + full name without a second lookup.
    const reads = await db.messageRead.findMany({
      where: { messageId: id },
      orderBy: { readAt: "asc" },
      select: {
        id: true,
        userId: true,
        readAt: true,
        user: {
          select: {
            id: true,
            fullName: true,
            username: true,
            role: true,
            avatar: true,
          },
        },
      },
    });

    return NextResponse.json({
      data: reads.map((r) => ({
        id: r.id,
        userId: r.userId,
        fullName: r.user.fullName,
        username: r.user.username,
        role: r.user.role,
        avatar: r.user.avatar,
        readAt: r.readAt.toISOString(),
      })),
    });
  },
);
