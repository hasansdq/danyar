import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/attendance/me — returns ALL attendance records for the current
 * user, with the className via the class relation.
 *
 * Auth: any authenticated user. NO module gate — students can always see
 * their own reports, even if the SUPERADMIN has disabled the global
 * module_attendance (they just won't be able to take attendance; the
 * historical records are still theirs to browse).
 *
 * Sort: date DESC, period ASC.
 *
 * Returns `{ data: AttendanceRecord[] }` where each record carries the
 * parsed `violations` array (string[] — empty when no violations or when
 * the JSON parse fails).
 */
export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.attendance.findMany({
    where: { userId: user.id },
    orderBy: [{ date: "desc" }, { period: "asc" }],
    include: {
      class: {
        select: {
          id: true,
          name: true,
          gradeLevel: true,
          section: true,
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
      class: r.class,
    })),
  });
}

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
