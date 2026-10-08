import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

// GET /api/admin/classes?search=...&page=1&pageSize=20
//
// Scope: when the requester is an ADMIN (school principal), only classes in
// `user.schoolId` are returned. SUPERADMIN sees everyone.
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
      { gradeLevel: { contains: search } },
      { section: { contains: search } },
    ];
  }

  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      return NextResponse.json({
        data: {
          items: [],
          total: 0,
          page,
          pageSize,
          totalPages: 0,
        },
      });
    }
    where.schoolId = user.schoolId;
  }

  // Phase 25 — only top-level CLASSES appear in the admin/classes list.
  // Subject groups (ClassRoom rows with parentClassId set) are now shown
  // as a sub-list within their parent class via the `groups` relation
  // below — implementing the user's policy: "گروه‌ها زیرمجموعه کلاس‌ها،
  // کلاس‌ها زیرمجموعه مدرسه".
  if (!where.AND) where.AND = [];
  (where.AND as any[]).push({ parentClassId: null });

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
        chatClosed: true,
        chatClosedAt: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
        memberships: {
          select: { id: true, role: true },
        },
        // Phase 25 — include the subject groups within each class (the
        // `groups` relation is the inverse of `parentClass`). For each
        // group we select id/name/section + a member count so the
        // admin UI can render the sub-list without an extra round-trip.
        groups: {
          select: {
            id: true,
            name: true,
            section: true,
            createdAt: true,
            _count: { select: { memberships: true } },
          },
          orderBy: { name: "asc" },
        },
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

// POST /api/admin/classes  body: { name, description?, gradeLevel?, section? }
//
// Scope: when the requester is an ADMIN (school principal), the new class is
// automatically assigned to `user.schoolId`. SUPERADMIN can specify schoolId
// explicitly (otherwise it stays null).
export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  await assertPermission(user.role, "manage_classes");

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

  // Determine schoolId.
  let schoolId: string | null = null;
  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      return NextResponse.json(
        { error: "شما به مدرسه‌ای متصل نیستید" },
        { status: 403 },
      );
    }
    schoolId = user.schoolId;
  } else if (user.role === "SUPERADMIN" && body?.schoolId) {
    // SUPERADMIN may optionally specify a schoolId.
    const schoolIdRaw = body.schoolId.toString().trim();
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
  }

  const existing = await db.classRoom.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ error: "Class name already exists" }, { status: 409 });
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
});
