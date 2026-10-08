import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";
import { saveFormDataFile } from "@/lib/upload";

export const dynamic = "force-dynamic";

// GET /api/admin/sample-questions?classId=...
// Lists sample questions (optionally filtered by class). Includes class name.
// Admin-only.
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const classId = url.searchParams.get("classId") || undefined;

  const questions = await db.sampleQuestion.findMany({
    // SECURITY: school scoping — an ADMIN (principal) only sees records of
    // their own school's classes (SUPERADMIN stays unscoped).
    where: classId
      ? { classId, ...(auth.user.role === "ADMIN" ? { class: { schoolId: auth.user.schoolId ?? "__none__" } } : {}) }
      : auth.user.role === "ADMIN"
        ? { class: { schoolId: auth.user.schoolId ?? "__none__" } }
        : undefined,
    orderBy: { createdAt: "desc" },
    include: {
      class: { select: { id: true, name: true, gradeLevel: true, section: true } },
      createdBy: { select: { id: true, fullName: true, username: true, role: true } },
    },
  });

  return NextResponse.json({
    data: questions.map((q) => ({
      id: q.id,
      classId: q.classId,
      class: q.class,
      title: q.title,
      description: q.description,
      fileName: q.fileName,
      fileUrl: q.fileUrl,
      createdAt: q.createdAt.toISOString(),
      createdBy: q.createdBy,
    })),
  });
}

// POST /api/admin/sample-questions
// Accepts JSON { classId, title, description?, createdById }
// or multipart/form-data with the same fields plus optional "file"
export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  await assertPermission(user.role, "manage_content");

  let fields: any = {};
  let uploaded: Awaited<ReturnType<typeof saveFormDataFile>> = null;

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    fields = {
      classId: form.get("classId")?.toString() || "",
      title: form.get("title")?.toString() || "",
      description: form.get("description")?.toString() || null,
      createdById: form.get("createdById")?.toString() || "",
    };

    const file = form.get("file");
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      try {
        uploaded = await saveFormDataFile(file as File, { actorId: user.id });
      } catch (e: any) {
        const msg = e?.message === "FILE_TOO_LARGE" ? "File too large (max 25MB)"
          : e?.message === "INVALID_EXTENSION" ? "File type not allowed"
          : e?.message || "File upload failed";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
  } else {
    try {
      fields = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const classId = (fields?.classId || "").toString().trim();
  const title = (fields?.title || "").toString().trim();
  const description = fields?.description ? fields.description.toString().trim() : null;
  const createdById = (fields?.createdById || "").toString().trim();

  if (!classId || !title || !createdById) {
    return NextResponse.json(
      { error: "classId, title, createdById are required" },
      { status: 400 },
    );
  }

  const [cls, createdBy] = await Promise.all([
    db.classRoom.findUnique({ where: { id: classId } }),
    db.user.findUnique({ where: { id: createdById } }),
  ]);
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (!createdBy) {
    return NextResponse.json({ error: "Creator user not found" }, { status: 404 });
  }

  // SECURITY (school scoping + attribution): an ADMIN (principal) may only
  // create records for classes in their OWN school, and the attributed
  // creator must belong to that same school (blocks cross-school attribution
  // forgery). SUPERADMIN stays unscoped.
  if (user.role === "ADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (createdBy.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden: creator must be in your school" }, { status: 403 });
    }
  }

  const question = await db.sampleQuestion.create({
    data: {
      classId,
      title,
      description,
      fileName: uploaded?.originalName ?? null,
      fileUrl: uploaded?.fileUrl ?? null,
      createdById,
    },
    select: {
      id: true,
      classId: true,
      title: true,
      description: true,
      fileName: true,
      fileUrl: true,
      createdAt: true,
      createdById: true,
    },
  });

  return NextResponse.json({ data: question }, { status: 201 });
});
