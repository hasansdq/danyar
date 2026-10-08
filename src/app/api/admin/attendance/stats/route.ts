import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { assertModule } from "@/lib/module-check";
import { toJalaali } from "jalaali-js";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/attendance/stats — ADMIN-only.
 *
 * Returns the daily + 7-day attendance statistics for the principal's
 * school. Module gate: "attendance". School-scoped for ADMIN via the
 * principal's `schoolId` (SUPERADMIN bypasses — but they'd have no
 * `schoolId`; we fall back to the first school, since SUPERADMIN owns
 * the platform).
 *
 * Returns:
 * {
 *   today: { totalStudents, present, absent, violations },
 *   week:  [{ date, present, absent, violations }, ...]   // 7 days, oldest→newest
 * }
 *
 * `totalStudents` is the count of DISTINCT userIds across ALL the
 * school's classes (via ClassMembership). It's only computed for today;
 * the 7-day list uses today's `totalStudents` as the denominator (so
 * the chart stays consistent even when enrollments changed mid-week).
 */

const PERSIAN_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

function toJalaliDateStr(d: Date): string {
  const j = toJalaali(d);
  const mm = String(j.jm).padStart(2, "0");
  const dd = String(j.jd).padStart(2, "0");
  return `${j.jy}-${mm}-${dd}`;
}

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

export async function GET() {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;
  await assertModule(user.role, "attendance");

  // Resolve the school to scope by. ADMIN uses their own schoolId;
  // SUPERADMIN has none, so we pick the first school (they own the
  // platform).
  let schoolId = user.schoolId;
  if (!schoolId) {
    const firstSchool = await db.school.findFirst({ select: { id: true } });
    schoolId = firstSchool?.id ?? null;
  }

  // No school — return empty stats (the platform has no data).
  if (!schoolId) {
    return NextResponse.json({
      data: {
        today: { totalStudents: 0, present: 0, absent: 0, violations: 0 },
        week: [],
      },
    });
  }

  // Total students in the school — distinct userIds across all classes
  // scoped to this school where the membership role is STUDENT.
  const schoolClasses = await db.classRoom.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const classIds = schoolClasses.map((c) => c.id);
  const distinctStudentsAgg = await db.classMembership.groupBy({
    by: ["userId"],
    where: {
      classId: { in: classIds },
      role: "STUDENT",
    },
  });
  const totalStudents = distinctStudentsAgg.length;

  // Build the last 7 Jalali date strings (oldest→newest), starting today.
  // We walk the JS Date backward 0..6 days, convert to Jalali, and dedupe
  // (very unlikely to dedupe but defensive).
  const today = new Date();
  const weekDates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    weekDates.push(toJalaliDateStr(d));
  }

  // Pull ALL attendance rows for those dates, scoped to the school.
  const rows = await db.attendance.findMany({
    where: {
      date: { in: weekDates },
      class: { schoolId },
    },
    select: {
      date: true,
      period: true,
      present: true,
      violations: true,
    },
  });

  // Aggregate per date. `violations` counts only when the student was
  // PRESENT (matches the frontend's "log a violation while in class"
  // semantic — an absent student has no in-class violation to log).
  const byDate = new Map<
    string,
    { present: number; absent: number; violations: number }
  >();
  for (const d of weekDates) {
    byDate.set(d, { present: 0, absent: 0, violations: 0 });
  }
  for (const r of rows) {
    const bucket = byDate.get(r.date);
    if (!bucket) continue;
    if (r.present) {
      bucket.present++;
      if (parseViolations(r.violations).length > 0) bucket.violations++;
    } else {
      bucket.absent++;
    }
  }

  const todayStr = weekDates[weekDates.length - 1];
  const todayBucket = byDate.get(todayStr) ?? {
    present: 0,
    absent: 0,
    violations: 0,
  };

  const week = weekDates.map((date) => {
    const b = byDate.get(date) ?? { present: 0, absent: 0, violations: 0 };
    return {
      date,
      monthName: PERSIAN_MONTHS[Number(date.split("-")[1]) - 1] ?? "",
      day: Number(date.split("-")[2]),
      present: b.present,
      absent: b.absent,
      violations: b.violations,
    };
  });

  return NextResponse.json({
    data: {
      today: {
        totalStudents,
        present: todayBucket.present,
        absent: todayBucket.absent,
        violations: todayBucket.violations,
      },
      week,
    },
  });
}
