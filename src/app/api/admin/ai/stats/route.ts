import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'
import { startOfToday } from '@/lib/ai/access'

/**
 * آمار مصرف و خطاهای دستیار — تنها شمارنده‌ها و نوع خطا؛
 * هیچ متن گفتگو یا محتوای پیامی در پاسخ نیست.
 */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const [todayLogs, totalOk, totalErr, recentErrors] = await Promise.all([
    db.aiUsageLog.findMany({ where: { createdAt: { gte: startOfToday() } }, select: { ok: true } }),
    db.aiUsageLog.count({ where: { ok: true } }),
    db.aiUsageLog.count({ where: { ok: false } }),
    db.aiUsageLog.findMany({
      where: { ok: false },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        errorType: true,
        provider: true,
        model: true,
        schoolId: true,
      },
    }),
  ])

  // نام مدارس خطاها با کوئری جداگانه (schoolId کلید خارجی نیست)
  const errSchoolIds = [...new Set(recentErrors.map((e) => e.schoolId).filter((s): s is string => !!s))]
  const errSchools = errSchoolIds.length
    ? await db.school.findMany({ where: { id: { in: errSchoolIds } }, select: { id: true, name: true } })
    : []
  const schoolName = new Map(errSchools.map((s) => [s.id, s.name]))

  // روند ۱۴ روز اخیر (شمارنده بدون محتوا)
  const since = new Date()
  since.setDate(since.getDate() - 13)
  since.setHours(0, 0, 0, 0)
  const logs = await db.aiUsageLog.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, ok: true },
  })
  const byDay: { day: string; ok: number; error: number }[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(since)
    d.setDate(since.getDate() + i)
    const key = d.toISOString().slice(0, 10)
    byDay.push({ day: key, ok: 0, error: 0 })
  }
  const dayMap = new Map(byDay.map((d) => [d.day, d]))
  for (const l of logs) {
    const key = l.createdAt.toISOString().slice(0, 10)
    const row = dayMap.get(key)
    if (row) {
      if (l.ok) row.ok++
      else row.error++
    }
  }

  return NextResponse.json({
    stats: {
      today: { ok: todayLogs.filter((l) => l.ok).length, error: todayLogs.filter((l) => !l.ok).length },
      total: { ok: totalOk, error: totalErr },
      byDay,
      recentErrors: recentErrors.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        errorType: e.errorType,
        provider: e.provider,
        model: e.model,
        schoolName: e.schoolId ? schoolName.get(e.schoolId) ?? null : null,
      })),
    },
  })
}
