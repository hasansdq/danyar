import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { apiHandler, badRequest } from "@/lib/api-utils";
import { assertPermission } from "@/lib/permission-check";

export const dynamic = "force-dynamic";

/**
 * Generate a 6-digit numeric password (e.g. "482913"). Mirrors the helper in
 * /api/admin/users/route.ts. Returned to the caller so the admin can give it
 * to the user.
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
 * Generate a candidate username for a STUDENT — pattern `s<6_digits>`. The
 * caller must verify uniqueness (inside a transaction) before committing.
 */
function generateStudentUsernameCandidate(): string {
  const digits = Math.floor(100000 + Math.random() * 900000).toString();
  return `s${digits}`;
}

/**
 * POST /api/admin/users/bulk
 *
 * Bulk-create students from the Excel-like admin-panel form (Phase 31).
 *
 * Body:
 *   {
 *     students: [
 *       { firstName: "علی", lastName: "محمدی", classId: "<id>", phone?: "..." },
 *       ...
 *     ]
 *   }
 *
 * For each student the backend:
 *   - auto-generates a unique username (s<6_digits>) + a 6-digit password
 *   - creates the User row (role=STUDENT, schoolId = principal's school)
 *   - auto-enrolls them in the parent class + every subject group within it
 *
 * All operations run in a single $transaction so the bulk insert is atomic
 * (all-or-nothing). The response includes the list of created users with
 * their generated credentials so the admin can copy them to a sheet + give
 * them to the students.
 *
 * Authorization: ADMIN (principal) or SUPERADMIN. The new students inherit
 * the principal's schoolId. Permission gate: "manage_users".
 *
 * Cap: 200 students per call (defends against runaway batch sizes + keeps
 * the transaction fast).
 */
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

  const studentsRaw: unknown = body?.students;
  if (!Array.isArray(studentsRaw) || studentsRaw.length === 0) {
    return badRequest("students must be a non-empty array");
  }
  if (studentsRaw.length > 200) {
    return badRequest("حداکثر ۲۰۰ دانش‌آموز در هر بار قابل ثبت است");
  }

  // School principal scoping — the new students inherit the principal's
  // schoolId. SUPERADMIN can use this endpoint too (with their own
  // schoolId resolution — but for SUPERADMIN we'd need an explicit
  // schoolId in the body; this Phase 31 redesign is for principals only).
  let targetSchoolId: string | null = null;
  if (user.role === "ADMIN") {
    if (!user.schoolId) {
      return NextResponse.json(
        { error: "شما به مدرسه‌ای متصل نیستید" },
        { status: 403 },
      );
    }
    targetSchoolId = user.schoolId;
  }

  // Normalize + validate each row up-front. We collect all rows first so
  // we can return a friendly per-row error (e.g. "ردیف ۳: نام الزامی است")
  // before any DB work.
  interface Row {
    firstName: string;
    lastName: string;
    fullName: string;
    classId: string;
    phone: string | null;
  }
  const rows: Row[] = [];
  for (let i = 0; i < studentsRaw.length; i++) {
    const r = studentsRaw[i] as Record<string, unknown>;
    const firstName = (typeof r?.firstName === "string" ? r.firstName : "").trim();
    const lastName = (typeof r?.lastName === "string" ? r.lastName : "").trim();
    const fullName =
      (typeof r?.fullName === "string" ? r.fullName : "").trim() ||
      [firstName, lastName].filter(Boolean).join(" ").trim();
    const classId =
      typeof r?.classId === "string" ? (r.classId as string).trim() : "";
    const phone =
      typeof r?.phone === "string" && r.phone.trim() ? r.phone.trim() : null;
    if (!firstName || !lastName) {
      return badRequest(`ردیف ${i + 1}: نام و نام خانوادگی الزامی است`);
    }
    if (!classId) {
      return badRequest(`ردیف ${i + 1}: انتخاب کلاس الزامی است`);
    }
    rows.push({ firstName, lastName, fullName, classId, phone });
  }

  // Batch-validate all classIds at once — every row's classId must:
  //   - exist + be a top-level class (parentClassId=null)
  //   - belong to the principal's school (or be unscoped for SUPERADMIN)
  const allClassIds = Array.from(new Set(rows.map((r) => r.classId)));
  const foundClasses = await db.classRoom.findMany({
    where: { id: { in: allClassIds } },
    select: { id: true, schoolId: true, parentClassId: true, name: true },
  });
  const classById = new Map(foundClasses.map((c) => [c.id, c]));
  if (foundClasses.length !== allClassIds.length) {
    const missing = allClassIds.filter((id) => !classById.has(id));
    return NextResponse.json(
      { error: "کلاس مورد نظر یافت نشد", missing },
      { status: 400 },
    );
  }
  for (const c of foundClasses) {
    if (c.parentClassId !== null) {
      return NextResponse.json(
        { error: `کلاس «${c.name}» یک گروه درسی است، نه کلاس سطح‌بالا` },
        { status: 400 },
      );
    }
    if (user.role === "ADMIN") {
      if (!c.schoolId || c.schoolId !== targetSchoolId) {
        return NextResponse.json(
          { error: `کلاس «${c.name}» در مدرسه شما نیست` },
          { status: 403 },
        );
      }
    }
  }

  // Pre-fetch the subject-group ids for each parent class so we can enroll
  // each new student in them inside the transaction without N+1 queries.
  const subjectGroupsByClass = new Map<string, Array<{ id: string }>>();
  for (const parentClass of foundClasses) {
    const groups = await db.classRoom.findMany({
      where: { parentClassId: parentClass.id },
      select: { id: true },
    });
    subjectGroupsByClass.set(parentClass.id, groups);
  }

  // Create every student + their memberships in a single transaction.
  const created = await db.$transaction(async (tx) => {
    const results: Array<{
      id: string;
      username: string;
      password: string;
      fullName: string;
      phone: string | null;
      className: string | null;
    }> = [];

    for (const row of rows) {
      // Generate a unique username (retry on collision inside the tx).
      let username = "";
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = generateStudentUsernameCandidate();
        const race = await tx.user.findUnique({
          where: { username: candidate },
          select: { id: true },
        });
        if (!race) {
          username = candidate;
          break;
        }
      }
      if (!username) {
        // Extremely unlikely (10 retries all collided) — fall back to a
        // 12-digit random.
        username = `s${Math.floor(Math.random() * 900000000000 + 100000000000)}`;
      }
      const password = generatePassword();
      const hashed = await bcrypt.hash(password, 10);

      const newUser = await tx.user.create({
        data: {
          username,
          password: hashed,
          fullName: row.fullName,
          role: "STUDENT",
          phone: row.phone,
          schoolId: targetSchoolId,
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          phone: true,
        },
      });

      // Auto-enroll in the parent class + every subject group within it.
      const parentClass = classById.get(row.classId)!;
      await tx.classMembership.create({
        data: {
          classId: parentClass.id,
          userId: newUser.id,
          role: "STUDENT",
        },
      });
      const subjectGroups = subjectGroupsByClass.get(parentClass.id) ?? [];
      if (subjectGroups.length > 0) {
        await tx.classMembership.createMany({
          data: subjectGroups.map((g) => ({
            classId: g.id,
            userId: newUser.id,
            role: "STUDENT",
          })),
        });
      }

      results.push({
        id: newUser.id,
        username: newUser.username,
        password,
        fullName: newUser.fullName,
        phone: newUser.phone,
        className: parentClass.name,
      });
    }

    return results;
  });

  return NextResponse.json(
    {
      data: {
        created,
        count: created.length,
      },
    },
    { status: 201 },
  );
});
