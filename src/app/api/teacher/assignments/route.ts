import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { saveFormDataFile, getField } from "@/lib/upload";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/assignments
 *
 * Body (multipart/form-data):
 *   - classId      (string, repeatable — at least one is required)
 *                  Accepts EITHER multiple `classId` entries OR a single
 *                  `classId` entry (for backward-compat with the original
 *                  single-class client).
 *   - title        (string, required)
 *   - description  (string, optional)
 *   - dueDate      (ISO string, optional)
 *   - file         (File, optional — uploaded ONCE, shared across all classes)
 *
 * Authorization: the authenticated user must be a TEACHER of EVERY class
 * they list (admins / superadmins bypass). Permission gate:
 * "create_assignment" (no-op for SUPERADMIN).
 *
 * Behaviour:
 *   - One Assignment row is created per selected class — same title,
 *     description, dueDate, file metadata (the file is uploaded ONCE,
 *     then the metadata is shared across all created rows so we don't
 *     store N copies of the same file on disk).
 *   - Returns `{ data: Assignment[] }` (array of all created assignments).
 *     Backward-compat: the single-class callers receive an array with one
 *     element; the new multi-class caller receives N elements.
 *   - Does NOT pre-create submission rows (the per-student status rows
 *     are created lazily when the teacher first sets a status).
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "assignments");

  await assertPermission(user.role, "create_assignment");

  const formData = await req.formData();

  // Collect classIds: prefer repeated `classId` entries (multi-class
  // form), fall back to a single `classId` entry (legacy client) for
  // backward compatibility. Empty strings are filtered, duplicates are
  // removed while preserving the original order.
  const rawClassIds = formData
    .getAll("classId")
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  const classIds = Array.from(new Set(rawClassIds));

  const title = getField(formData, "title");
  const description = getField(formData, "description");
  const dueDateRaw = getField(formData, "dueDate");
  const file = formData.get("file");

  if (classIds.length === 0) {
    return badRequest("classId is required (select at least one class)");
  }
  if (!title || title.trim().length === 0) {
    return badRequest("title is required");
  }

  // Authorization: the calling user must be a teacher of EVERY listed
  // class (admins / superadmins bypass). We do this with one batched
  // membership query so we don't fan out into N+1 round-trips.
  const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
  if (!isAdmin) {
    const memberships = await db.classMembership.findMany({
      where: { userId: user.id, classId: { in: classIds } },
      select: { classId: true, role: true },
    });
    const teacherOfClassIds = new Set(
      memberships
        .filter((m) => m.role === "TEACHER")
        .map((m) => m.classId),
    );
    // Reject if ANY of the listed classes is not taught by this teacher.
    const notAllowed = classIds.filter((id) => !teacherOfClassIds.has(id));
    if (notAllowed.length > 0) {
      return NextResponse.json(
        {
          error: "Forbidden",
          message:
            "شما به همه کلاس‌های انتخاب‌شده دسترسی ندارید.",
          notAllowed,
        },
        { status: 403 },
      );
    }
  }

  // Validate the classes exist (batched). Only fetch the columns we need
  // for the response.
  const classRooms = await db.classRoom.findMany({
    where: { id: { in: classIds } },
    select: { id: true, name: true, section: true, schoolId: true },
  });
  const classRoomById = new Map(classRooms.map((c) => [c.id, c]));
  if (classRooms.length !== classIds.length) {
    const missing = classIds.filter((id) => !classRoomById.has(id));
    return NextResponse.json(
      { error: "Class not found", missing },
      { status: 404 },
    );
  }
  // SECURITY (school scoping): an ADMIN (principal) may only create
  // assignments in classes of their OWN school. SUPERADMIN stays unscoped.
  if (user.role === "ADMIN") {
    const notInSchool = classRooms.filter(
      (c) => !user.schoolId || c.schoolId !== user.schoolId,
    );
    if (notInSchool.length > 0) {
      return NextResponse.json(
        { error: "Forbidden", notAllowed: notInSchool.map((c) => c.id) },
        { status: 403 },
      );
    }
  }

  let dueDate: Date | null = null;
  if (dueDateRaw) {
    const parsed = new Date(dueDateRaw);
    if (Number.isNaN(parsed.getTime())) {
      return badRequest("Invalid dueDate (must be ISO string)");
    }
    dueDate = parsed;
  }

  // Handle optional file upload — the file is saved ONCE, and the same
  // fileName / fileUrl / fileSize metadata is reused across every created
  // assignment row so we don't store duplicate copies on disk.
  let fileName: string | null = null;
  let fileUrl: string | null = null;
  let fileSize: number | null = null;

  if (file && file instanceof File) {
    const uploaded = await saveFormDataFile(file, { actorId: user.id });
    if (uploaded) {
      fileName = uploaded.originalName;
      fileUrl = uploaded.fileUrl;
      fileSize = uploaded.fileSize;
    }
  }

  // Create one Assignment per listed class. We use a transaction so
  // either ALL classes get the assignment or none of them do (no partial
  // state if one class fails the create).
  const createdRows = await db.$transaction(
    classIds.map((cid) =>
      db.assignment.create({
        data: {
          classId: cid,
          title: title.trim(),
          description: description?.trim() || null,
          dueDate,
          fileName,
          fileUrl,
          fileSize,
          createdById: user.id,
        },
        include: {
          createdBy: {
            select: { id: true, fullName: true, username: true, role: true },
          },
        },
      })
    ),
  );

  return NextResponse.json(
    {
      data: createdRows.map((a) => {
        const cls = classRoomById.get(a.classId)!;
        return {
          id: a.id,
          classId: a.classId,
          class: cls,
          title: a.title,
          description: a.description,
          dueDate: a.dueDate ? a.dueDate.toISOString() : null,
          fileName: a.fileName,
          fileUrl: a.fileUrl,
          fileSize: a.fileSize,
          createdAt: a.createdAt.toISOString(),
          createdBy: a.createdBy,
        };
      }),
    },
    { status: 201 },
  );
});
