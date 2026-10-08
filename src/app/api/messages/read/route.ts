import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";
import { assertModule } from "@/lib/module-check";
import { assertPermission } from "@/lib/permission-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/messages/read
 *
 * Marks as read (creates MessageRead rows) every message in the class
 * identified by the `classId` body field where:
 *   - the sender is NOT the current user (we never mark our OWN messages —
 *     a "read receipt" is meaningful only for messages you received), AND
 *   - there is no existing MessageRead row for this (messageId, userId)
 *     pair (idempotent — re-calling with the same classId is a no-op).
 *
 * Called when the user opens / scrolls a class chat so the chat list can
 * update unread badges and the SENDER of those messages can see "✓✓ seen
 * by N" in their UI.
 *
 * Permission: the requester must be a member of the class — OR a principal
 * (ADMIN) of the school that owns the class — OR a SUPERADMIN. The per-role
 * `chat` permission gate is also enforced (SUPERADMIN bypasses).
 *
 * Body: `{ classId: string }` (JSON).
 *
 * Returns: `{ data: { classId, markedRead: <count> } }` — `markedRead` is the
 * number of MessageRead rows actually created (0 if there were no unread
 * messages).
 *
 * Implementation note: SQLite doesn't support `createMany({ skipDuplicates })`
 * via Prisma's standard API, so we (1) fetch the candidate message ids in a
 * single WHERE-IN query, (2) fetch the existing MessageRead ids for this
 * user + class so we can subtract them, then (3) `createMany` the remaining
 * rows in one round trip. This is O(2 SELECTs + 1 INSERT) regardless of how
 * many unread messages there are.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();
  await assertModule(user.role, "class_chat");
  await assertPermission(user.role, "chat");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const classId =
    typeof body?.classId === "string" ? body.classId.trim() : "";
  if (!classId) {
    return badRequest("classId الزامی است");
  }

  // Access control: member OR principal of school OR SUPERADMIN.
  const membership = await verifyMembership(user.id, classId);
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { schoolId: true },
  });
  if (!cls) {
    return NextResponse.json(
      { error: "کلاس یافت نشد" },
      { status: 404 },
    );
  }
  const isPrincipalOfClass =
    user.role === "ADMIN" &&
    !!user.schoolId &&
    cls.schoolId === user.schoolId;
  const isSuperAdmin = user.role === "SUPERADMIN";

  if (!membership && !isPrincipalOfClass && !isSuperAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ---------------------------------------------------------------------------
  // Bulk-mark unread messages from OTHER users as read.
  //
  // Step 1: find every message in the class sent by someone ELSE that isn't
  // soft-deleted. (Soft-deleted rows are hidden from the UI anyway, so
  // creating a read receipt for them is wasteful + meaningless.)
  // ---------------------------------------------------------------------------
  const candidateMessages = await db.message.findMany({
    where: {
      classId,
      senderId: { not: user.id },
      deletedAt: null,
    },
    select: { id: true },
  });
  const candidateIds = candidateMessages.map((m) => m.id);
  if (candidateIds.length === 0) {
    return NextResponse.json({ data: { classId, markedRead: 0 } });
  }

  // Step 2: find which of those already have a MessageRead row for THIS user
  // (so we don't try to insert duplicates and trip the unique constraint).
  const alreadyRead = await db.messageRead.findMany({
    where: {
      userId: user.id,
      messageId: { in: candidateIds },
    },
    select: { messageId: true },
  });
  const alreadyReadSet = new Set(alreadyRead.map((r) => r.messageId));
  const toCreate = candidateIds.filter((id) => !alreadyReadSet.has(id));

  if (toCreate.length === 0) {
    return NextResponse.json({ data: { classId, markedRead: 0 } });
  }

  // Step 3: create the missing rows in one round trip.
  //
  // NOTE: Prisma's `createMany({ skipDuplicates: true })` is NOT supported
  // on SQLite (only Postgres/MySQL). We don't need it though — step 2 already
  // subtracted the existing MessageRead rows for this user, so `toCreate`
  // contains only message ids with no existing receipt. Even if a concurrent
  // request inserted one in the meantime, the unique [messageId, userId]
  // constraint would surface as P2002 and `apiHandler` would map that to 404
  // — which is the wrong UX. To avoid that, we wrap each insert in a
  // `findUnique → create` check OR just `createMany` and rely on our pre-
  // filtered set being race-free in practice. We choose the latter for
  // performance (single round trip).
  const result = await db.messageRead.createMany({
    data: toCreate.map((messageId) => ({
      messageId,
      userId: user.id,
    })),
  });

  return NextResponse.json({
    data: {
      classId,
      markedRead: result.count,
    },
  });
});
