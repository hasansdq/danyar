import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";
import { assertModule } from "@/lib/module-check";
import { badRequest, notFound } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/attendance/by-class?classId=X — ADMIN-only.
 *
 * Module gate: "attendance". School-scoped for ADMIN via the principal's
 * `schoolId` (the class must belong to the principal's school; SUPERADMIN
 * bypasses).
 *
 * Returns per-student attendance summary for the class:
 * [
 *   {
 *     userId, fullName,
 *     totalRecords,   // total attendance rows for this student in this class
 *     absentCount,    // rows where present=false
 *     violationCount, // rows where the violations JSON array is non-empty
 *     recentAbsences:   [{ date, period }]   // last 5, newest first
 *     recentViolations: [{ date, period, violations }]  // last 5, newest first
 *   }
 * ]
 *
 * Students are sorted by fullName asc. Only STUDENT members of the class
 * are included (teachers/principals who happen to be members aren't listed
 * as attendance targets).
 */

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

export async function GET(req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;
  await assertModule(user.role, "attendance");

  const classId = (req.nextUrl.searchParams.get("classId") || "").trim();
  if (!classId) return badRequest("classId الزامی است");

  // Verify the class exists + belongs to the principal's school.
  const cls = await db.classRoom.findUnique({
    where: { id: classId },
    select: { id: true, name: true, schoolId: true },
  });
  if (!cls) return notFound("کلاس یافت نشد");

  if (user.role !== "SUPERADMIN") {
    if (!user.schoolId || cls.schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // All STUDENT members of the class — the attendance targets.
  const members = await db.classMembership.findMany({
    where: { classId, role: "STUDENT" },
    include: {
      user: { select: { id: true, fullName: true, username: true } },
    },
  });
  const memberUserIds = members.map((m) => m.user.id);

  // All attendance rows for this class+student set.
  const rows = await db.attendance.findMany({
    where: { classId, userId: { in: memberUserIds } },
    orderBy: [{ date: "desc" }, { period: "desc" }],
    select: {
      id: true,
      userId: true,
      date: true,
      period: true,
      present: true,
      violations: true,
      createdAt: true,
    },
  });

  // Group rows by userId so we can produce a per-student summary in one pass.
  const byUser = new Map<
    string,
    {
      totalRecords: number;
      absentCount: number;
      violationCount: number;
      recentAbsences: { date: string; period: number }[];
      recentViolations: { date: string; period: number; violations: string[] }[];
    }
  >();
  for (const m of members) {
    byUser.set(m.user.id, {
      totalRecords: 0,
      absentCount: 0,
      violationCount: 0,
      recentAbsences: [],
      recentViolations: [],
    });
  }

  // rows is already sorted newest-first (date desc, period desc).
  for (const r of rows) {
    const bucket = byUser.get(r.userId);
    if (!bucket) continue;
    bucket.totalRecords++;
    if (!r.present) {
      bucket.absentCount++;
      if (bucket.recentAbsences.length < 5) {
        bucket.recentAbsences.push({ date: r.date, period: r.period });
      }
    }
    const v = parseViolations(r.violations);
    if (v.length > 0) {
      bucket.violationCount++;
      if (bucket.recentViolations.length < 5) {
        bucket.recentViolations.push({
          date: r.date,
          period: r.period,
          violations: v,
        });
      }
    }
  }

  // Sort the members by fullName (asc) for a stable alphabetical list.
  members.sort((a, b) =>
    a.user.fullName.localeCompare(b.user.fullName, "fa"),
  );

  return NextResponse.json({
    data: members.map((m) => {
      const b = byUser.get(m.user.id)!;
      return {
        userId: m.user.id,
        fullName: m.user.fullName,
        username: m.user.username,
        totalRecords: b.totalRecords,
        absentCount: b.absentCount,
        violationCount: b.violationCount,
        recentAbsences: b.recentAbsences,
        recentViolations: b.recentViolations,
      };
    }),
  });
}
