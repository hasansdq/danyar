import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { apiHandler } from "@/lib/api-utils";
import { verifyMembership } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * POST /api/classes/[id]/streaming
 *
 * Toggles the per-group streaming (online class) flag. Only a TEACHER
 * of the class (or an ADMIN/SUPERADMIN) can toggle it. When enabled,
 * the streaming FAB becomes visible to ALL group members. When disabled,
 * the FAB is hidden from everyone.
 *
 * Body: { enabled: boolean }
 *
 * Returns the updated ClassRoom with the new `streamingEnabled` value.
 */
export const POST = apiHandler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireAuth();
  const { id: classId } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const enabled = !!body?.enabled;

  // Authorization: caller must be a teacher of the class (admins bypass
  // with school-scoping, superadmin bypasses entirely).
  const membership = await verifyMembership(user.id, classId);
  const isTeacher = !!membership && membership.role === "TEACHER";
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  if (!isTeacher && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validate the class exists.
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { id: true, schoolId: true },
  });
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // School-scoping for ADMIN.
  if (user.role === "ADMIN" && cls.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Check the school's streaming flag — if the school has streaming
  // disabled, we don't allow enabling it on any group.
  if (enabled && cls.schoolId) {
    const school = await db.school.findUnique({
      where: { id: cls.schoolId },
      select: { streamingEnabled: true },
    });
    if (school && !school.streamingEnabled) {
      return NextResponse.json(
        { error: "استریم برای این مدرسه توسط مدیر کل غیرفعال شده است." },
        { status: 403 },
      );
    }
  }

  const updated = await db.classRoom.update({
    where: { id: classId },
    data: { streamingEnabled: enabled },
    select: { id: true, streamingEnabled: true },
  });

  return NextResponse.json({ data: updated });
});
