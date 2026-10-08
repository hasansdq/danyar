import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";
import { apiHandler, notFound } from "@/lib/api-utils";
import { assertModule } from "@/lib/module-check";
import { verifyMembership } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * POST /api/messages/[id]/pin — set or clear the pin on a message.
 *
 * Auth: TEACHER / ADMIN / SUPERADMIN. Module gate: "class_chat"
 * (pinning is part of the class-chat feature set).
 *
 * School-scoped for ADMIN: the principal must own the school that owns
 * the message's class. TEACHERs must be a member of the class
 * (ClassMembership — any role). SUPERADMIN bypasses.
 *
 * Body: `{ pin: true | false }`.
 *   - `pin: true`  → sets `pinnedById` + `pinnedAt = now()` on the Message.
 *   - `pin: false` → clears `pinnedById` + `pinnedAt` (sets both to null).
 *
 * Idempotent — pinning an already-pinned message just refreshes the
 * timestamp + pinnedById. Un-pinning an already-unpinned message is a
 * no-op.
 *
 * Returns `{ data: { id, pinned: boolean } }` where `pinned` reflects
 * the post-write state (true after pin, false after unpin).
 */
export const POST = apiHandler<{ id: string }>(
  async (req: NextRequest, ctx) => {
    const user = await getApiUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      user.role !== "TEACHER" &&
      user.role !== "ADMIN" &&
      user.role !== "SUPERADMIN"
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    await assertModule(user.role, "class_chat");

    const { id } = await ctx.params;
    if (!id) return notFound("شناسه پیام الزامی است");

    // Parse body — tolerate empty body (default to pin=true).
    let body: any = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // fall through — treat as empty body
    }
    const pin = body?.pin === undefined ? true : Boolean(body.pin);

    // Load the message so we know its classId + verify it's not deleted.
    const message = await db.message.findUnique({
      where: { id },
      select: { id: true, classId: true, deletedAt: true },
    });
    if (!message) return notFound("پیام یافت نشد");
    if (message.deletedAt) {
      return NextResponse.json(
        { error: "این پیام حذف شده و قابل سنجاق نیست" },
        { status: 400 },
      );
    }

    // Access control.
    const cls = await db.classRoom.findUnique({
      where: { id: message.classId },
      select: { schoolId: true },
    });
    const isPrincipalOfClass =
      user.role === "ADMIN" &&
      !!user.schoolId &&
      cls?.schoolId === user.schoolId;
    const isMember = !!(await verifyMembership(user.id, message.classId));
    const isSuperAdmin = user.role === "SUPERADMIN";

    if (!isSuperAdmin && !isPrincipalOfClass && !isMember) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (pin) {
      const updated = await db.message.update({
        where: { id },
        data: {
          pinnedById: user.id,
          pinnedAt: new Date(),
        },
        select: { id: true, pinnedById: true, pinnedAt: true },
      });
      return NextResponse.json({
        data: {
          id: updated.id,
          pinned: true,
          pinnedById: updated.pinnedById,
          pinnedAt: updated.pinnedAt?.toISOString() ?? null,
        },
      });
    }

    const updated = await db.message.update({
      where: { id },
      data: {
        pinnedById: null,
        pinnedAt: null,
      },
      select: { id: true, pinnedById: true, pinnedAt: true },
    });
    return NextResponse.json({
      data: {
        id: updated.id,
        pinned: false,
        pinnedById: null,
        pinnedAt: null,
      },
    });
  },
);
