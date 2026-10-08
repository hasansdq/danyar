import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminApi } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET /api/admin/stats
//
// SECURITY: an ADMIN (principal) receives stats scoped to THEIR OWN school
// only (cross-tenant PII isolation). SUPERADMIN receives platform-wide stats.
export async function GET(_req: NextRequest) {
  const auth = await requireAdminApi();
  if (auth.response) return auth.response;
  const user = auth.user;

  // School scope for principals; null = unscoped (SUPERADMIN).
  const scoped = user.role === "ADMIN";
  const schoolId = scoped ? (user.schoolId ?? "__none__") : null;

  const [
    totalUsers,
    totalStudents,
    totalTeachers,
    totalAdmins,
    totalClasses,
    totalMessages,
    totalAssignments,
    totalSampleQuestions,
    totalGrades,
    totalBehaviors,
    recentUsers,
    recentClasses,
  ] = await Promise.all([
    db.user.count({ where: scoped ? { schoolId } : undefined }),
    db.user.count({ where: scoped ? { schoolId, role: "STUDENT" } : { role: "STUDENT" } }),
    db.user.count({ where: scoped ? { schoolId, role: "TEACHER" } : { role: "TEACHER" } }),
    db.user.count({ where: scoped ? { schoolId, role: "ADMIN" } : { role: "ADMIN" } }),
    db.classRoom.count({ where: scoped ? { schoolId } : undefined }),
    db.message.count({ where: scoped ? { class: { schoolId } } : undefined }),
    db.assignment.count({ where: scoped ? { class: { schoolId } } : undefined }),
    db.sampleQuestion.count({ where: scoped ? { class: { schoolId } } : undefined }),
    db.grade.count({ where: scoped ? { class: { schoolId } } : undefined }),
    db.behaviorMark.count({ where: scoped ? { class: { schoolId } } : undefined }),
    db.user.findMany({
      where: scoped ? { schoolId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        username: true,
        role: true,
        fullName: true,
        createdAt: true,
      },
    }),
    db.classRoom.findMany({
      where: scoped ? { schoolId } : undefined,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        gradeLevel: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    }),
  ]);

  return NextResponse.json({
    data: {
      totalUsers,
      totalStudents,
      totalTeachers,
      totalAdmins,
      totalClasses,
      totalMessages,
      totalAssignments,
      totalSampleQuestions,
      totalGrades,
      totalBehaviors,
      recentUsers,
      recentClasses,
    },
  });
}
