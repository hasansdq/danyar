import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";
import { audit, AuditActions } from "@/lib/audit";
import { checkPasswordPolicy } from "@/lib/password-policy";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["STUDENT", "TEACHER", "ADMIN", "SUPERADMIN"]);

/**
 * GET /api/superadmin/users?role=&search=&page=&pageSize=
 *
 * Lists all users (no password) with membership counts + school info.
 * Supports role filter + text search (username / fullName / phone).
 */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const url = req.nextUrl;
  const role = url.searchParams.get("role")?.toUpperCase() || undefined;
  const search = url.searchParams.get("search")?.trim() || undefined;
  const schoolId = url.searchParams.get("schoolId")?.trim() || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(
    1,
    Math.min(100, parseInt(url.searchParams.get("pageSize") || "20", 10)),
  );

  const where: any = {};
  if (role && VALID_ROLES.has(role)) {
    where.role = role;
  }
  if (schoolId) {
    where.schoolId = schoolId;
  }
  if (search) {
    where.OR = [
      { username: { contains: search } },
      { fullName: { contains: search } },
      { phone: { contains: search } },
    ];
  }

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        fullName: true,
        phone: true,
        avatar: true,
        schoolId: true,
        createdAt: true,
        updatedAt: true,
        school: { select: { id: true, name: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    data: {
      items: users,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}

/**
 * POST /api/superadmin/users
 * Body: { username, password, fullName, role (STUDENT|TEACHER|ADMIN|SUPERADMIN), phone?, schoolId? }
 *
 * Hashes password (bcrypt), lowercases username, 409 on conflict.
 * If schoolId is provided, validates it references a real School.
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

  const username = (body?.username || "").toString().trim().toLowerCase();
  const password = (body?.password || "").toString();
  const fullName = (body?.fullName || "").toString().trim();
  const role = (body?.role || "STUDENT").toString().toUpperCase();
  const phone = body?.phone ? body.phone.toString().trim() : null;
  const schoolId = body?.schoolId ? body.schoolId.toString().trim() : null;

  if (!username || !password || !fullName) {
    return NextResponse.json(
      { error: "username, password, fullName are required" },
      { status: 400 },
    );
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json(
      { error: "role must be STUDENT, TEACHER, ADMIN, or SUPERADMIN" },
      { status: 400 },
    );
  }
  // SECURITY: server-side password policy.
  const policy = checkPasswordPolicy(password, { username });
  if (!policy.ok) {
    return NextResponse.json({ error: policy.reason }, { status: 400 });
  }

  // SUPERADMIN has no school; ignore any provided schoolId for them.
  // Phase 23: schoolId is REQUIRED for STUDENT/TEACHER/ADMIN roles.
  let resolvedSchoolId: string | null = null;
  if (role !== "SUPERADMIN") {
    if (!schoolId) {
      return NextResponse.json(
        { error: "انتخاب مدرسه برای کاربر الزامی است" },
        { status: 400 },
      );
    }
    const school = await db.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      return NextResponse.json(
        { error: "مدرسه مورد نظر یافت نشد" },
        { status: 400 },
      );
    }
    resolvedSchoolId = schoolId;
  }

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) {
    return NextResponse.json(
      { error: "نام کاربری قبلاً استفاده شده است" },
      { status: 409 },
    );
  }

  const hashed = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: {
      username,
      password: hashed,
      fullName,
      role,
      phone,
      schoolId: resolvedSchoolId,
    },
    select: {
      id: true,
      username: true,
      role: true,
      fullName: true,
      phone: true,
      avatar: true,
      schoolId: true,
      createdAt: true,
      updatedAt: true,
      school: { select: { id: true, name: true } },
    },
  });

  // AUDIT: user creation (role + school attribution).
  await audit({
    actor: { id: auth.user.id, username: auth.user.username, role: auth.user.role, schoolId: auth.user.schoolId ?? null },
    action: AuditActions.USER_CREATE,
    targetType: "user",
    targetId: user.id,
    req,
    meta: { createdUsername: username, createdRole: role, schoolId: resolvedSchoolId ?? null },
  });

  return NextResponse.json({ data: user }, { status: 201 });
}
