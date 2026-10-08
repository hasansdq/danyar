import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/session";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/teacher/dm-settings
 * Returns the current DM permission toggles for the principal's school.
 */
export const GET = apiHandler(async () => {
  const user = await requireAuth();
  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "فقط مدیر یا مدیر کل می‌تواند تنظیمات چت خصوصی را ببیند" },
      { status: 403 },
    );
  }
  let schoolId: string | null | undefined = user.schoolId;
  if (!schoolId && user.role === "SUPERADMIN") {
    const asPrincipal = await db.school.findUnique({
      where: { principalId: user.id },
      select: { id: true },
    });
    schoolId = asPrincipal?.id ?? null;
  }
  if (!schoolId) {
    return notFound("مدرسه‌ای یافت نشد");
  }
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { dmTeacherStudent: true, dmStudentStudent: true, dmPrincipalStudent: true },
  });
  if (!school) return notFound("مدرسه یافت نشد");
  return NextResponse.json({ data: school });
});

/**
 * PATCH /api/teacher/dm-settings
 *
 * Body JSON: `{ dmTeacherStudent?, dmStudentStudent?, dmPrincipalStudent? }`
 *
 * Allows the principal (ADMIN role) to toggle the DM-permission settings
 * on their OWN school. SUPERADMIN is also allowed; they patch the school
 * whose principalId points at them (or, if none, their own schoolId —
 * which is null for SUPERADMIN, so they get a 404 telling them to use the
 * superadmin schools endpoint instead).
 *
 * Returns: `{ data: { schoolId, dmTeacherStudent, dmStudentStudent, dmPrincipalStudent } }`.
 */
export const PATCH = apiHandler(async (req: NextRequest) => {
  const user = await requireAuth();

  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { error: "فقط مدیر یا مدیر کل می‌تواند تنظیمات چت خصوصی را تغییر دهد" },
      { status: 403 },
    );
  }

  let body: {
    dmTeacherStudent?: unknown;
    dmStudentStudent?: unknown;
    dmPrincipalStudent?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  // Resolve the target school.
  //  - ADMIN (principal): use user.schoolId (their own school).
  //  - SUPERADMIN: prefer their own schoolId (null in practice) → fall back
  //    to the school whose principalId points at them.
  let schoolId: string | null | undefined;
  if (user.role === "ADMIN") {
    schoolId = user.schoolId;
  } else {
    // SUPERADMIN: patch the school whose principalId === user.id, if any.
    if (user.schoolId) {
      schoolId = user.schoolId;
    } else {
      const asPrincipal = await db.school.findUnique({
        where: { principalId: user.id },
        select: { id: true },
      });
      schoolId = asPrincipal?.id ?? null;
    }
  }

  if (!schoolId) {
    return notFound(
      "مدرسه‌ای برای ویرایش تنظیمات چت خصوصی یافت نشد",
    );
  }

  const data: {
    dmTeacherStudent?: boolean;
    dmStudentStudent?: boolean;
    dmPrincipalStudent?: boolean;
  } = {};

  if (body.dmTeacherStudent !== undefined) {
    if (typeof body.dmTeacherStudent !== "boolean") {
      return badRequest("dmTeacherStudent must be a boolean");
    }
    data.dmTeacherStudent = body.dmTeacherStudent;
  }
  if (body.dmStudentStudent !== undefined) {
    if (typeof body.dmStudentStudent !== "boolean") {
      return badRequest("dmStudentStudent must be a boolean");
    }
    data.dmStudentStudent = body.dmStudentStudent;
  }
  if (body.dmPrincipalStudent !== undefined) {
    if (typeof body.dmPrincipalStudent !== "boolean") {
      return badRequest("dmPrincipalStudent must be a boolean");
    }
    data.dmPrincipalStudent = body.dmPrincipalStudent;
  }

  if (Object.keys(data).length === 0) {
    return badRequest("هیچ فیلدی برای به‌روزرسانی ارسال نشد");
  }

  const updated = await db.school.update({
    where: { id: schoolId },
    data,
    select: {
      id: true,
      dmTeacherStudent: true,
      dmStudentStudent: true,
      dmPrincipalStudent: true,
    },
  });

  return NextResponse.json({
    data: {
      schoolId: updated.id,
      dmTeacherStudent: updated.dmTeacherStudent,
      dmStudentStudent: updated.dmStudentStudent,
      dmPrincipalStudent: updated.dmPrincipalStudent,
    },
  });
});
