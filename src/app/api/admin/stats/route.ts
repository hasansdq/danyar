import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'

/** آمار کلی پلتفرم برای داشبورد مدیر کل */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const [totalSchools, activeSchools, classrooms, groups, totalUsers, admins, teachers, students, groupMessages] =
    await Promise.all([
      db.school.count(),
      db.school.count({ where: { isActive: true } }),
      db.classroom.count(),
      db.subjectGroup.count(),
      db.user.count(),
      db.user.count({ where: { role: 'SCHOOL_ADMIN' } }),
      db.user.count({ where: { role: 'TEACHER' } }),
      db.user.count({ where: { role: 'STUDENT' } }),
      db.message.count(),
          ])

  // همه مدارس برای نمای آماری
  const schoolsOverview = await db.school.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      isActive: true,
      _count: { select: { classrooms: true, users: true } },
    },
  })

  return NextResponse.json({
    stats: {
      totalSchools,
      activeSchools,
      classrooms,
      groups,
      totalUsers,
      admins,
      teachers,
      students,
      messages: groupMessages,
    },
    schoolsOverview,
  })
}
