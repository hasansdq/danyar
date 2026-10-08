import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

const VALID_ROLES = new Set(["STUDENT", "TEACHER", "ADMIN"]);

/* -------------------------------------------------------------------------- */
/* Helpers — auto-generate username + password when the caller doesn't pass  */
/* them. Used by the new admin-panel create-user flow (Phase 31).            */
/* -------------------------------------------------------------------------- */

/**
 * Generate a strong random password (12 chars: mixed case + digits),
 * cryptographically secure, compliant with the password policy. Returned to
 * the caller so the admin can give it to the user (user should change it
 * after first login).
 */
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const pick = (chars: string, n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const idx = crypto.getRandomValues(new Uint32Array(1))[0] % chars.length;
      out.push(chars[idx]);
    }
    return out.join("");
  };
  // 2 upper + 2 lower + 2 digits + 6 mixed = 12 chars (policy-compliant).
  return pick(upper, 2) + pick(lower, 2) + pick(digits, 2) + pick(all, 6);
}

/**
 * Generate a unique username based on the user's role + a random suffix.
 *
 * Pattern: `<role_prefix><6_random_digits>` — e.g. `s482913` for a student,
 * `t938271` for a teacher. The role prefix (`s` / `t`) makes it obvious at a
 * glance what role the user has; the 6 digits are random + guaranteed unique
 * by retrying on collision (up to 10 attempts, then it falls back to a
 * 10-digit random username).
 *
 * The username is not derived from the user's Persian name because:
 *   1. Transliterating Persian → ASCII is locale-prone and error-prone.
 *   2. Two students named "علی محمدی" would get the same derived username —
 *      we'd need a numeric suffix anyway.
 *   3. The 6-digit suffix is easier for the user to type + remember.
 *
 * The admin sees the generated username in the success dialog and gives it to
 * the user (along with the generated password).
 */
async function generateUniqueUsername(role: "STUDENT" | "TEACHER"): Promise<string> {
  const prefix = role === "STUDENT" ? "s" : "t";
  for (let attempt = 0; attempt < 10; attempt++) {
    const digits = Math.floor(100000 + Math.random() * 900000).toString();
    const candidate = `${prefix}${digits}`;
    // Check uniqueness — the users table has a unique constraint on username.
    const existing = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Fallback: 10-digit random (collision probability negligible).
  return `${prefix}${Math.floor(Math.random() * 9000000000 + 1000000000)}`;
}

// GET /api/admin/users?role=STUDENT&search=...&page=1&pageSize=20
//
// Scope: when the requester is an ADMIN (school principal), only users in
// `user.schoolId` are returned. SUPERADMIN sees everyone.
export const GET = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  const url = req.nextUrl;
  const role = url.searchParams.get("role") || undefined;
  const search = url.searchParams.get("search")?.trim() || undefined;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.max(1, Math.min(100, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const where: any = {};
  if (role && VALID_ROLES.has(role.toUpperCase())) {
    where.role = role.toUpperCase();
  }
  if (search) {
    where.OR = [
      { username: { contains: search } },
      { fullName: { contains: search } },
      { phone: { contains: search } },
    ];
  }

  // School principal scoping — SUPERADMIN is unscoped.
  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      // Defensive: principal without a school → empty result, not the whole DB.
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
        // Phase 25 — include each user's class memberships so the admin
        // users table can show a "کلاس" column (the user's top-level class)
        // and a "گروه" column (the user's subject groups). For each
        // membership we select the class's id, name, parentClassId (to
        // distinguish class from group), and the parentClass's name (so
        // we can show "هفتم · ریاضی هفتم" in the cell).
        memberships: {
          select: {
            role: true,
            class: {
              select: {
                id: true,
                name: true,
                parentClassId: true,
                parentClass: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // Phase 25 — flatten the memberships into the response shape the frontend
  // expects. For each user we build:
  //   - primaryClass: the first top-level class (parentClassId=null) the
  //     user is a member of, or null. (A student is normally enrolled in
  //     exactly one class via the create-student flow; teachers may be in
  //     many. We pick the first for display.)
  //   - classes: list of all top-level classes the user is a member of.
  //   - groups: list of all subject groups (parentClassId != null) the user
  //     is a member of, each tagged with its parent class name for display.
  const items = users.map((u) => {
    const classes = u.memberships
      .filter((m) => m.class.parentClassId === null)
      .map((m) => ({
        id: m.class.id,
        name: m.class.name,
        role: m.role,
      }));
    const groups = u.memberships
      .filter((m) => m.class.parentClassId !== null)
      .map((m) => ({
        id: m.class.id,
        name: m.class.name,
        parentClassName: m.class.parentClass?.name ?? null,
        role: m.role,
      }));
    // (Phase 25) memberships are consumed above; strip them so they don't
    // leak into the API response.
    const { memberships, ...rest } = u;
    return {
      ...rest,
      primaryClass: classes[0] ?? null,
      classes,
      groups,
    };
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
});

// POST /api/admin/users
//
// Body shape (Phase 31 redesign — backward-compatible with Phase 25/30):
//
//   Option A — explicit username + password (legacy / messenger FAB):
//     {
//       username: "ali.m",
//       password: "1234",
//       fullName: "علی محمدی",
//       role: "STUDENT",
//       phone?: "...",
//       classId?: "<parent-class-id>"   // single class (STUDENT or TEACHER)
//     }
//
//   Option B — auto-generate username + password (admin panel redesign):
//     {
//       firstName: "علی",
//       lastName: "محمدی",
//       role: "STUDENT",
//       phone?: "...",
//       classId?: "<parent-class-id>"        // single class (STUDENT)
//       classIds?: ["<id1>", "<id2>", ...]   // multi-class (TEACHER)
//     }
//
// When `username` is empty/missing, the backend auto-generates one as
// `<role_prefix><6_random_digits>` (e.g. `s482913`). When `password` is
// empty/missing, the backend auto-generates a 6-digit numeric password.
// The generated credentials are returned in the response so the admin can
// give them to the user.
//
// Auto-enrollment (Phase 25 + 30 + 31):
//   - STUDENT: when `classId` is provided, the student is auto-enrolled in
//     that parent class + every subject group within it.
//   - TEACHER: when `classIds` (array) is provided, the teacher is auto-
//     enrolled in EACH listed parent class + every subject group within
//     each. (When `classId` single is provided instead, only that class is
//     used — backward compat with Phase 30.)
// All runs in a single $transaction (atomic — all-or-nothing).
//
// Scope: when the requester is an ADMIN (school principal):
//   - The new user's schoolId is FORCED to user.schoolId.
//   - The role can only be STUDENT or TEACHER — principals cannot create
//     ADMINs (only SUPERADMIN can). 403 with Persian message otherwise.
//
// SUPERADMIN can create any role (incl. ADMIN) and may optionally specify
// schoolId (handled in /api/superadmin/users POST).
export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  await assertPermission(user.role, "manage_users");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const explicitUsername = (body?.username || "").toString().trim().toLowerCase();
  const explicitPassword = (body?.password || "").toString();
  const fullNameRaw = (body?.fullName || "").toString().trim();
  // Phase 31 — split first/last name fields for the admin-panel redesign.
  const firstName = (body?.firstName || "").toString().trim();
  const lastName = (body?.lastName || "").toString().trim();
  // Combine first + last into fullName when the caller doesn't pass fullName.
  const fullName =
    fullNameRaw ||
    [firstName, lastName].filter(Boolean).join(" ").trim();
  const role = (body?.role || "STUDENT").toString().toUpperCase();
  const phone = body?.phone ? (body.phone).toString().trim() : null;
  // Phase 31 — classId (single) OR classIds (array, for multi-class teachers).
  const classId = body?.classId ? (body.classId).toString().trim() : null;
  const classIdsRaw: unknown = body?.classIds;
  const classIds: string[] = Array.isArray(classIdsRaw)
    ? classIdsRaw
        .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
        .filter((v: string) => v.length > 0)
    : [];

  if (!fullName) {
    return NextResponse.json(
      { error: "نام و نام خانوادگی الزامی است" },
      { status: 400 },
    );
  }
  if (!VALID_ROLES.has(role)) {
    return NextResponse.json(
      { error: "role must be STUDENT, TEACHER, or ADMIN" },
      { status: 400 },
    );
  }
  // SECURITY: server-side password policy for explicit passwords.
  if (explicitPassword) {
    const policy = checkPasswordPolicy(explicitPassword, { username: (body?.username || "").toString() });
    if (!policy.ok) {
      return NextResponse.json({ error: policy.reason }, { status: 400 });
    }
  }

  // School-scoped principal: cannot create ADMINs (only SUPERADMIN can), and
  // the new user must be in the principal's own school.
  let targetSchoolId: string | null = null;
  if (user.role === "ADMIN") {
    if (role === "ADMIN") {
      return NextResponse.json(
        { error: "فقط مدیر کل می‌تواند مدیر مدرسه ایجاد کند" },
        { status: 403 },
      );
    }
    if (!user.schoolId) {
      return NextResponse.json(
        { error: "شما به مدرسه‌ای متصل نیستید" },
        { status: 403 },
      );
    }
    targetSchoolId = user.schoolId;
  }

  // Resolve the final username + password (use explicit if provided, else
  // auto-generate). When auto-generating, we retry on username collision.
  let username = explicitUsername;
  let generatedUsername = false;
  if (!username) {
    if (role !== "STUDENT" && role !== "TEACHER") {
      return NextResponse.json(
        { error: "نام کاربری برای نقش‌های غیر از دانش‌آموز/معلم الزامی است" },
        { status: 400 },
      );
    }
    username = await generateUniqueUsername(role as "STUDENT" | "TEACHER");
    generatedUsername = true;
  }
  // If username was explicitly provided, check uniqueness before doing work.
  if (!generatedUsername) {
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json(
        { error: "Username already exists" },
        { status: 409 },
      );
    }
  }

  let password = explicitPassword;
  let generatedPassword: string | null = null;
  if (!password) {
    generatedPassword = generatePassword();
    password = generatedPassword;
  }

  // Phase 31 — resolve the list of classIds to enroll the user in. For
  // STUDENT, only `classId` (single) is used. For TEACHER, `classIds` (array)
  // takes priority, but we fall back to `classId` (single) for backward
  // compat with Phase 30.
  let resolvedClassIds: string[] = [];
  if (role === "STUDENT") {
    if (classId) resolvedClassIds = [classId];
  } else if (role === "TEACHER") {
    if (classIds.length > 0) resolvedClassIds = classIds;
    else if (classId) resolvedClassIds = [classId];
  }

  // Phase 25 + 30 + 31 — validate every classId BEFORE creating the user.
  // Each class must exist, be a top-level class (parentClassId=null), and
  // belong to the principal's school (or be unscoped if SUPERADMIN).
  const parentClasses: Array<{
    id: string;
    schoolId: string | null;
    parentClassId: string | null;
  }> = [];
  if (resolvedClassIds.length > 0) {
    const found = await db.classRoom.findMany({
      where: { id: { in: resolvedClassIds } },
      select: { id: true, schoolId: true, parentClassId: true },
    });
    if (found.length !== resolvedClassIds.length) {
      const missing = resolvedClassIds.filter(
        (id) => !found.find((c) => c.id === id),
      );
      return NextResponse.json(
        { error: "کلاس مورد نظر یافت نشد", missing },
        { status: 400 },
      );
    }
    for (const c of found) {
      if (c.parentClassId !== null) {
        return NextResponse.json(
          { error: "فقط کلاس‌های سطح‌بالا (نه گروه درسی) قابل انتخاب هستند" },
          { status: 400 },
        );
      }
      if (user.role === "ADMIN") {
        if (!c.schoolId || c.schoolId !== targetSchoolId) {
          return NextResponse.json(
            { error: "این کلاس در مدرسه شما نیست" },
            { status: 403 },
          );
        }
      }
      parentClasses.push(c);
    }
  }

  const hashed = await bcrypt.hash(password, 10);

  // Phase 25 + 30 + 31 — single transaction: create the user + auto-enroll
  // them in every listed class + every subject group within each class.
  const created = await db.$transaction(async (tx) => {
    // Re-check username uniqueness inside the transaction (race safety) —
    // if we auto-generated and a concurrent insert grabbed the same name,
    // throw + let the caller retry.
    if (generatedUsername) {
      const race = await tx.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (race) {
        throw new Error("username-collision");
      }
    }

    const newUser = await tx.user.create({
      data: {
        username,
        password: hashed,
        fullName,
        role,
        phone,
        schoolId: targetSchoolId,
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

    // Auto-enroll STUDENT and TEACHER roles in every resolved parent class
    // + every subject group within each class. The membership role mirrors
    // the user's role so the chat-service + admin panel can scope
    // who-can-post-where per subject correctly.
    for (const parentClass of parentClasses) {
      // 1. Enroll in the parent class.
      await tx.classMembership.create({
        data: {
          classId: parentClass.id,
          userId: newUser.id,
          role,
        },
      });
      // 2. Enroll in ALL subject groups within the parent class.
      const subjectGroups = await tx.classRoom.findMany({
        where: { parentClassId: parentClass.id },
        select: { id: true },
      });
      if (subjectGroups.length > 0) {
        await tx.classMembership.createMany({
          data: subjectGroups.map((g) => ({
            classId: g.id,
            userId: newUser.id,
            role,
          })),
        });
      }
    }

    return newUser;
  });

  // Surface the generated credentials (if any) so the admin can give them
  // to the user. Only included when the caller didn't pass them.
  return NextResponse.json(
    {
      data: {
        ...created,
        generatedUsername,
        generatedPassword,
      },
    },
    { status: 201 },
  );
});
