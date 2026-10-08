import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/classes?search=&page=&pageSize=
 *
 * Lists all classes with student/teacher counts + school info.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || undefined;
  const schoolId = url.searchParams.get("schoolId")?.trim() || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(
    1,
    Math.min(100, parseInt(url.searchParams.get("pageSize") || "20", 10)),
  );

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { gradeLevel: { contains: search } },
      { section: { contains: search } },
    ];
  }
  if (schoolId) {
    where.schoolId = schoolId;
  }

  const [total, classes] = await Promise.all([
    db.classRoom.count({ where }),
    db.classRoom.findMany({
      where,
      select: {
        id: true,
        name: true,
        description: true,
        gradeLevel: true,
        section: true,
        schoolId: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
        memberships: { select: { id: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = classes.map((c) => {
    const studentCount = c.memberships.filter((m) => m.role === "STUDENT").length;
    const teacherCount = c.memberships.filter((m) => m.role === "TEACHER").length;
    const memberCount = c.memberships.length;
    const { memberships, ...rest } = c;
    return { ...rest, studentCount, teacherCount, memberCount };
  });

  return NextResponse.json({
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

/**
 * POST /api/superadmin/classes
 * Body: { name, description?, gradeLevel?, section?, schoolId? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body?.name || "").toString().trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const description = body?.description ? body.description.toString().trim() : null;
  const gradeLevel = body?.gradeLevel ? body.gradeLevel.toString().trim() : null;
  const section = body?.section ? body.section.toString().trim() : null;
  const schoolIdRaw = body?.schoolId ? body.schoolId.toString().trim() : null;

  // Validate schoolId if provided.
  let schoolId: string | null = null;
  if (schoolIdRaw) {
    const school = await db.school.findUnique({ where: { id: schoolIdRaw } });
    if (!school) {
      return NextResponse.json(
        { error: "مدرسه مورد نظر یافت نشد" },
        { status: 400 },
      );
    }
    schoolId = schoolIdRaw;
  }

  const existing = await db.classRoom.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: "Class name already exists" },
      { status: 409 },
    );
  }

  const cls = await db.classRoom.create({
    data: { name, description, gradeLevel, section, schoolId },
    select: {
      id: true,
      name: true,
      description: true,
      gradeLevel: true,
      section: true,
      schoolId: true,
      createdAt: true,
      updatedAt: true,
      school: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ data: cls }, { status: 201 });
}
