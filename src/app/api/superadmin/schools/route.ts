import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/schools?search=&page=&pageSize=
 *
 * Lists all schools with principal info + teacher/student counts.
 */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(
    1,
    Math.min(100, parseInt(url.searchParams.get("pageSize") || "20", 10)),
  );

  const where: any = {};
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { address: { contains: search } },
    ];
  }

  const [total, schools] = await Promise.all([
    db.school.count({ where }),
    db.school.findMany({
      where,
      select: {
        id: true,
        name: true,
        address: true,
        principalId: true,
        createdAt: true,
        updatedAt: true,
        principal: {
          select: {
            id: true,
            username: true,
            fullName: true,
            phone: true,
            role: true,
          },
        },
        members: {
          where: { role: { in: ["TEACHER", "STUDENT"] } },
          select: { id: true, role: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items = schools.map((s) => {
    const teacherCount = s.members.filter((m) => m.role === "TEACHER").length;
    const studentCount = s.members.filter((m) => m.role === "STUDENT").length;
    const { members, ...rest } = s;
    return { ...rest, teacherCount, studentCount };
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
 * POST /api/superadmin/schools
 * Body: { name, address? }
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
    return NextResponse.json({ error: "نام مدرسه الزامی است" }, { status: 400 });
  }
  const address = body?.address ? body.address.toString().trim() : null;

  const existing = await db.school.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json(
      { error: "مدرسه‌ای با این نام قبلاً ثبت شده است" },
      { status: 409 },
    );
  }

  // AUDIT: school creation.
  await audit({
    actor: { id: auth.user.id, username: auth.user.username, role: auth.user.role, schoolId: auth.user.schoolId ?? null },
    action: AuditActions.SCHOOL_CREATE,
    req,
    meta: { name },
  });
  const school = await db.school.create({
    data: { name, address },
    select: {
      id: true,
      name: true,
      address: true,
      principalId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ data: school }, { status: 201 });
}
