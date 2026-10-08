import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { isTeacherOf } from "@/lib/membership";
import { assertPermission } from "@/lib/permission-check";
import { assertModule } from "@/lib/module-check";
import { saveFormDataFile, getField } from "@/lib/upload";
import { assertClassSchoolScope } from "@/lib/authz";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/teacher/sample-questions
 *
 * Body (multipart/form-data):
 *   - classId      (string, required)
 *   - title        (string, required)
 *   - description  (string, optional)
 *   - file         (File, optional)
 *
 * Verifies the authenticated user is a TEACHER of the class (admins bypass).
 * Permission gate: "create_sample_question" (no-op for SUPERADMIN).
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  // Global module gate — SUPERADMIN bypasses.
  await assertModule(user.role, "sample_questions");

  await assertPermission(user.role, "create_sample_question");

  const formData = await req.formData();

  const classId = getField(formData, "classId");
  const title = getField(formData, "title");
  const description = getField(formData, "description");
  const file = formData.get("file");

  if (!classId) return badRequest("classId is required");
  if (!title || title.trim().length === 0) {
    return badRequest("title is required");
  }

  const teacherOf = await isTeacherOf(user.id, classId);
  if (!teacherOf) {
    const isAdmin = user.role === "ADMIN" || user.role === "SUPERADMIN";
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  // SECURITY (school scoping): an ADMIN (principal) may only create sample
  // questions in classes of their OWN school. SUPERADMIN stays unscoped.
  if (!teacherOf && user.role === "ADMIN") {
    const scopeError = await assertClassSchoolScope(user, classId);
    if (scopeError) return scopeError;
  }

  const classRoom = await db.classRoom.findUnique({ where: { id: classId } });
  if (!classRoom) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  let fileName: string | null = null;
  let fileUrl: string | null = null;
  // Note: SampleQuestion schema only stores fileName + fileUrl, no fileSize.
  let fileSize: number | null = null;

  if (file && file instanceof File) {
    const uploaded = await saveFormDataFile(file, { actorId: user.id });
    if (uploaded) {
      fileName = uploaded.originalName;
      fileUrl = uploaded.fileUrl;
      fileSize = uploaded.fileSize;
    }
  }

  const question = await db.sampleQuestion.create({
    data: {
      classId,
      title: title.trim(),
      description: description?.trim() || null,
      fileName,
      fileUrl,
      createdById: user.id,
    },
    include: {
      createdBy: {
        select: { id: true, fullName: true, username: true, role: true },
      },
    },
  });

  return NextResponse.json(
    {
      data: {
        id: question.id,
        classId: question.classId,
        title: question.title,
        description: question.description,
        fileName: question.fileName,
        fileUrl: question.fileUrl,
        fileSize, // echo back for client convenience
        createdAt: question.createdAt.toISOString(),
        createdBy: question.createdBy,
      },
    },
    { status: 201 },
  );
});
