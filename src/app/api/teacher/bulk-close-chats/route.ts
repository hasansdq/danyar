import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/bulk-close-chats
 * Body JSON: { classIds?: string[] }
 *
 * Closes chats for many classes at once.
 *
 *  - If `classIds` is provided: close ONLY those classes (the requester
 *    must be a TEACHER of each, unless they are ADMIN — admins bypass and
 *    can close any class). For teachers, any classId they don't teach is
 *    silently filtered out (returns the actually-closed list).
 *  - If `classIds` is omitted: for a TEACHER close ALL classes they teach;
 *    for an ADMIN close ALL classes.
 *
 * Permission gate: "bulk_chat_management" (no-op for SUPERADMIN).
 *
 * Returns { data: { count, classIds: [...] } }.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "bulk_chat");

  await assertPermission(user.role, "bulk_chat_management");

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // body is optional in this endpoint; default to empty object.
    body = {};
  }

  let requestedIds: string[] | undefined;
  if (body?.classIds !== undefined) {
    if (!Array.isArray(body.classIds)) {
      return badRequest("classIds must be an array");
    }
    requestedIds = body.classIds
      .map((x: unknown) => (typeof x === "string" ? x : ""))
      .filter((s: string) => s.length > 0);
  }

  // Determine target class IDs based on role + filter.
  let targetClassIds: string[];
  if (user.role === "ADMIN" || user.role === "SUPERADMIN") {
    // SECURITY (school scoping): an ADMIN is the principal of ONE school —
    // they may only close chats of classes in their OWN school. SUPERADMIN
    // stays unscoped (all classes platform-wide). An ADMIN without a
    // schoolId fails closed (empty target list).
    if (requestedIds && requestedIds.length > 0) {
      if (user.role === "ADMIN") {
        if (user.schoolId) {
          const scopedClasses = await db.classRoom.findMany({
            where: { id: { in: requestedIds }, schoolId: user.schoolId },
            select: { id: true },
          });
          const inSchoolIds = new Set(scopedClasses.map((c) => c.id));
          // Silently drop cross-school ids (mirrors the teacher filter).
          targetClassIds = requestedIds.filter((id) => inSchoolIds.has(id));
        } else {
          targetClassIds = [];
        }
      } else {
        targetClassIds = requestedIds;
      }
    } else if (user.role === "ADMIN") {
      const allClasses = user.schoolId
        ? await db.classRoom.findMany({
            where: { schoolId: user.schoolId },
            select: { id: true },
          })
        : [];
      targetClassIds = allClasses.map((c) => c.id);
    } else {
      const allClasses = await db.classRoom.findMany({ select: { id: true } });
      targetClassIds = allClasses.map((c) => c.id);
    }
  } else {
    // TEACHER (or STUDENT — but students have no classes they teach; we
    // still let them through and they'll get an empty result).
    const teacherMemberships = await db.classMembership.findMany({
      where: { userId: user.id, role: "TEACHER" },
      select: { classId: true },
    });
    const taughtIds = new Set(teacherMemberships.map((m) => m.classId));
    if (requestedIds && requestedIds.length > 0) {
      targetClassIds = requestedIds.filter((id) => taughtIds.has(id));
    } else {
      targetClassIds = Array.from(taughtIds);
    }
  }

  if (targetClassIds.length === 0) {
    return NextResponse.json({ data: { count: 0, classIds: [] } });
  }

  // Verify all targets exist (defensive; teachers' list is already validated
  // via membership; admins could pass arbitrary ids).
  const existing = await db.classRoom.findMany({
    where: { id: { in: targetClassIds } },
    select: { id: true },
  });
  const validIds = existing.map((c) => c.id);

  const now = new Date();
  // Update all in one query.
  const result = await db.classRoom.updateMany({
    where: { id: { in: validIds } },
    data: {
      chatClosed: true,
      chatClosedAt: now,
      chatClosedById: user.id,
    },
  });

  return NextResponse.json({
    data: {
      count: result.count,
      classIds: validIds,
      chatClosedAt: now.toISOString(),
    },
  });
});
