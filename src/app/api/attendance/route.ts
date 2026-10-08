import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";
import { apiHandler, badRequest, notFound } from "@/lib/api-utils";
import { assertModule } from "@/lib/module-check";
import { verifyMembership } from "@/lib/membership";

export const dynamic = "force-dynamic";

/**
 * Attendance API — GET + POST for /api/attendance.
 *
 * Auth: TEACHER / ADMIN / SUPERADMIN. (Students use /api/attendance/me to
 * view their own reports.)
 *
 * Module gate: "attendance" — when the SUPERADMIN disables the global
 * module_attendance SiteSetting, every call to this route is rejected
 * with 403 (ModuleDisabledError → Persian "ماژول «attendance» غیرفعال است").
 *
 * School-scoped for ADMIN: a principal may only take attendance for classes
 * inside their own school. TEACHERs must be a TEACHER member of the class
 * (via ClassMembership). SUPERADMIN bypasses both checks.
 *
 * GET /api/attendance?classId=...&date=YYYY-MM-DD&period=1..4
 *   Returns the existing Attendance rows for that (class, date, period).
 *
 * POST /api/attendance  body: {
 *   classId: string,
 *   date: "YYYY-MM-DD" (Jalali),
 *   period: 1..4,
 *   records: Array<{ userId, present, violations?: string[] }>
 * }
 *   Upserts each record against the @@unique([classId, userId, date, period]).
 *   `violations` is a JSON-encoded string array of Persian violation
 *   descriptions (or null when empty).
 *   Returns `{ data: { upserted: N } }` — N = number of records written.
 */

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** Validate a Jalali date string "YYYY-MM-DD". Year 1300..1500, month 1..12, day 1..31. */
function isValidJalaliDate(s: string): boolean {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s ?? "");
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return y >= 1300 && y <= 1500 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

/** Authorize the caller for the given classId + return the class row. */
async function authorizeForClass(
  userRole: string,
  userId: string,
  userSchoolId: string | null | undefined,
  classId: string,
) {
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: {
      id: true,
      name: true,
      schoolId: true,
    },
  });
  if (!cls) return { error: notFound("کلاس یافت نشد"), cls: null };

  if (userRole === "SUPERADMIN") return { error: null, cls };

  if (userRole === "ADMIN") {
    // Principal must own the class's school.
    if (!userSchoolId || cls.schoolId !== userSchoolId) {
      return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), cls: null };
    }
    return { error: null, cls };
  }

  // TEACHER — must be a TEACHER member of the class.
  const membership = await verifyMembership(userId, classId);
  if (!membership || membership.role !== "TEACHER") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), cls: null };
  }
  return { error: null, cls };
}

// -------------------- GET --------------------

export async function GET(req: NextRequest) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "TEACHER" && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await assertModule(user.role, "attendance");

  const url = req.nextUrl;
  const classId = (url.searchParams.get("classId") || "").trim();
  const date = (url.searchParams.get("date") || "").trim();
  const periodStr = (url.searchParams.get("period") || "").trim();
  const period = Number(periodStr);

  if (!classId) return badRequest("classId الزامی است");
  if (!date || !isValidJalaliDate(date)) {
    return badRequest("تاریخ جلالی معتبر نیست (YYYY-MM-DD)");
  }
  if (!Number.isInteger(period) || period < 1 || period > 4) {
    return badRequest("زنگ باید عدد صحیح ۱ تا ۴ باشد");
  }

  const authz = await authorizeForClass(user.role, user.id, user.schoolId, classId);
  if (authz.error) return authz.error;

  const rows = await db.attendance.findMany({
    where: { classId, date, period },
    orderBy: { user: { fullName: "asc" } },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          role: true,
        },
      },
    },
  });

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      classId: r.classId,
      userId: r.userId,
      date: r.date,
      period: r.period,
      present: r.present,
      violations: parseViolations(r.violations),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      user: r.user,
    })),
  });
}

// -------------------- POST --------------------

export const POST = apiHandler(async (req: NextRequest) => {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== "TEACHER" && user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await assertModule(user.role, "attendance");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return badRequest("بدنه درخواست نامعتبر است");
  }

  const classId = (body?.classId || "").toString().trim();
  const date = (body?.date || "").toString().trim();
  const period = Number(body?.period);
  const records: any[] = Array.isArray(body?.records) ? body.records : [];

  if (!classId) return badRequest("classId الزامی است");
  if (!date || !isValidJalaliDate(date)) {
    return badRequest("تاریخ جلالی معتبر نیست (YYYY-MM-DD)");
  }
  if (!Number.isInteger(period) || period < 1 || period > 4) {
    return badRequest("زنگ باید عدد صحیح ۱ تا ۴ باشد");
  }
  if (records.length === 0) {
    return badRequest("حداقل یک رکورد لازم است");
  }

  const authz = await authorizeForClass(user.role, user.id, user.schoolId, classId);
  if (authz.error) return authz.error;

  // Validate each record. We collect normalized rows up-front so the
  // whole batch is atomic (no half-applied state on a partial failure).
  type Normalized = {
    userId: string;
    present: boolean;
    violations: string | null;
  };
  const normalized: Normalized[] = [];
  const seenUsers = new Set<string>();
  for (const r of records) {
    const userId = (r?.userId || "").toString().trim();
    if (!userId) return badRequest("userId هر رکورد الزامی است");
    if (seenUsers.has(userId)) {
      return badRequest("userId تکراری در رکوردها");
    }
    seenUsers.add(userId);
    const present = r?.present === undefined ? true : Boolean(r.present);
    const violationsIn = Array.isArray(r?.violations) ? r.violations : [];
    const violationsArr: string[] = violationsIn
      .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
      .filter((v: string) => v.length > 0);
    const violations =
      violationsArr.length > 0 ? JSON.stringify(violationsArr) : null;
    normalized.push({ userId, present, violations });
  }

  // Verify every student is actually a member of this class (defence in
  // depth — prevents a teacher from saving attendance rows for students
  // outside the class via direct API access).
  const memberships = await db.classMembership.findMany({
    where: { classId, userId: { in: normalized.map((n) => n.userId) } },
    select: { userId: true },
  });
  const memberIds = new Set(memberships.map((m) => m.userId));
  const nonMembers = normalized.filter((n) => !memberIds.has(n.userId));
  if (nonMembers.length > 0) {
    return badRequest("برخی از دانش‌آموزان عضو این کلاس نیستند");
  }

  // Upsert each record against the @@unique([classId, userId, date, period]).
  // Sequential — SQLite is happier with one writer at a time and the
  // batch is small (a class has tens of students).
  let upserted = 0;
  for (const n of normalized) {
    await db.attendance.upsert({
      where: {
        classId_userId_date_period: {
          classId,
          userId: n.userId,
          date,
          period,
        },
      },
      update: {
        present: n.present,
        violations: n.violations,
      },
      create: {
        classId,
        userId: n.userId,
        date,
        period,
        present: n.present,
        violations: n.violations,
      },
    });
    upserted++;
  }

  // Touch nothing else. The frontend invalidates its own query cache.
  return NextResponse.json({
    data: {
      upserted,
      classId,
      date,
      period,
      monthName: PERSIAN_MONTHS[Number(date.split("-")[1]) - 1] ?? "",
    },
  });
});

/** Parse the `violations` JSON string back to a string array. Empty on failure. */
function parseViolations(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((v) => (typeof v === "string" ? v : String(v)))
        .filter((v) => v.length > 0);
    }
  } catch {
    return [];
  }
  return [];
}
