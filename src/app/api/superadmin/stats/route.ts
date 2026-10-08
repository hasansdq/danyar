import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSuperAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/superadmin/stats
 *
 * Returns aggregate platform stats:
 *  - totalUsers, countsByRole { STUDENT, TEACHER, ADMIN, SUPERADMIN }
 *  - totalSchools, totalClasses, totalMessages, totalAssignments, totalPolls
 *  - recentUsers(5), recentClasses(5), recentSchools(5)
 */
export async function GET(_req: NextRequest) {
  const auth = await requireSuperAdminApi();
  if (auth.response) return auth.response;

  const [
    totalUsers,
    studentsCount,
    teachersCount,
    adminsCount,
    superAdminsCount,
    totalSchools,
    totalClasses,
    totalMessages,
    totalAssignments,
    totalPolls,
    recentUsers,
    recentClasses,
    recentSchools,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: "STUDENT" } }),
    db.user.count({ where: { role: "TEACHER" } }),
    db.user.count({ where: { role: "ADMIN" } }),
    db.user.count({ where: { role: "SUPERADMIN" } }),
    db.school.count(),
    db.classRoom.count(),
    db.message.count(),
    db.assignment.count(),
    db.poll.count(),
    db.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        username: true,
        role: true,
        fullName: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
      },
    }),
    db.classRoom.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        gradeLevel: true,
        section: true,
        createdAt: true,
        school: { select: { id: true, name: true } },
        _count: { select: { memberships: true } },
      },
    }),
    db.school.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        principal: {
          select: { id: true, fullName: true, username: true },
        },
        members: { select: { id: true, role: true } },
      },
    }),
  ]);

  const recentSchoolsParsed = recentSchools.map((s) => {
    const teacherCount = s.members.filter((m) => m.role === "TEACHER").length;
    const studentCount = s.members.filter((m) => m.role === "STUDENT").length;
    const { members, ...rest } = s;
    return { ...rest, teacherCount, studentCount };
  });

  return NextResponse.json({
    data: {
      totalUsers,
      countsByRole: {
        STUDENT: studentsCount,
        TEACHER: teachersCount,
        ADMIN: adminsCount,
        SUPERADMIN: superAdminsCount,
      },
      totalSchools,
      totalClasses,
      totalMessages,
      totalAssignments,
      totalPolls,
      recentUsers,
      recentClasses,
      recentSchools: recentSchoolsParsed,
    },
  });
}
