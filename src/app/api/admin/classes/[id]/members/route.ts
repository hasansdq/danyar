import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const VALID_MEMBER_ROLES = new Set(["STUDENT", "TEACHER"]);

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/classes/[id]/members
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;

  const cls = await db.classRoom.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      schoolId: true,
      memberships: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              role: true,
              phone: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  // SECURITY: school scoping — an ADMIN (principal) may only list members of
  // classes in their own school.
  if (auth.user.role === "ADMIN" && (!auth.user.schoolId || cls.schoolId !== auth.user.schoolId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ data: cls });
}

// POST /api/admin/classes/[id]/members  body: { userId, role: "STUDENT"|"TEACHER" }
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;

  const { id } = await params;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userId = (body?.userId || "").toString().trim();
  const role = (body?.role || "STUDENT").toString().toUpperCase();

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!VALID_MEMBER_ROLES.has(role)) {
    return NextResponse.json(
      { error: "role must be STUDENT or TEACHER" },
      { status: 400 },
    );
  }

  const [cls, user] = await Promise.all([
    db.classRoom.findUnique({ where: { id } }),
    db.user.findUnique({ where: { id: userId } }),
  ]);
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // SECURITY: school scoping — an ADMIN (principal) may only enroll users
  // into classes of their OWN school, and only users of that same school
  // (blocks cross-tenant enrollment which would grant chat access).
  if (auth.user.role === "ADMIN") {
    if (!auth.user.schoolId || cls.schoolId !== auth.user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (user.schoolId !== auth.user.schoolId) {
      return NextResponse.json({ error: "Forbidden: user must be in your school" }, { status: 403 });
    }
  }

  const existing = await db.classMembership.findUnique({
    where: { classId_userId: { classId: id, userId } },
  });

  if (existing) {
    // Already a member — update role if different
    if (existing.role !== role) {
      const updated = await db.classMembership.update({
        where: { classId_userId: { classId: id, userId } },
        data: { role },
        include: {
          user: { select: { id: true, username: true, fullName: true, role: true, phone: true } },
        },
      });
      return NextResponse.json({
        data: {
          id: updated.id,
          classId: id,
          userId: updated.userId,
          role: updated.role,
          createdAt: updated.createdAt,
          user: updated.user,
          updated: true,
        },
      });
    }
    return NextResponse.json({
      data: {
        id: existing.id,
        classId: id,
        userId: existing.userId,
        role: existing.role,
        createdAt: existing.createdAt,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          role: user.role,
          phone: user.phone,
        },
        alreadyMember: true,
      },
    });
  }

  const membership = await db.classMembership.create({
    data: { classId: id, userId, role },
    include: {
      user: { select: { id: true, username: true, fullName: true, role: true, phone: true } },
    },
  });

  return NextResponse.json(
    {
      data: {
        id: membership.id,
        classId: id,
        userId: membership.userId,
        role: membership.role,
        createdAt: membership.createdAt,
        user: membership.user,
      },
    },
    { status: 201 },
  );
}
