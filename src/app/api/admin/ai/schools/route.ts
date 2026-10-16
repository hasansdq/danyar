import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'
import { startOfToday } from '@/lib/ai/access'

/** فهرست مدارس با تنظیمات دستیار و آمار مصرف (بدون هیچ محتوایی از گفتگوها) */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const [schools, todayLogs, allLogs] = await Promise.all([
    db.school.findMany({
      select: {
        id: true,
        name: true,
        isActive: true,
        aiSetting: { select: { enabled: true, managerEnabled: true, dailyMessageLimit: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.aiUsageLog.findMany({ where: { createdAt: { gte: startOfToday() } }, select: { schoolId: true, ok: true } }),
    db.aiUsageLog.findMany({ select: { schoolId: true, ok: true, createdAt: true, errorType: true } }),
  ])

  const perSchool = schools.map((s) => {
    const today = todayLogs.filter((l) => l.schoolId === s.id)
    const all = allLogs.filter((l) => l.schoolId === s.id)
    const lastError = [...all].reverse().find((l) => !l.ok)
    return {
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      aiEnabled: s.aiSetting?.enabled ?? false,
      managerEnabled: s.aiSetting?.managerEnabled ?? true,
      dailyMessageLimit: s.aiSetting?.dailyMessageLimit ?? null,
      messagesToday: today.filter((l) => l.ok).length,
      messagesTotal: all.filter((l) => l.ok).length,
      errorsToday: today.filter((l) => !l.ok).length,
      errorsTotal: all.filter((l) => !l.ok).length,
      lastErrorAt: lastError?.createdAt?.toISOString() ?? null,
      lastErrorType: lastError?.errorType ?? null,
    }
  })

  return NextResponse.json({ schools: perSchool })
}

/** تنظیم دستیار برای یک مدرسه: فعال/غیرفعال، نقش‌ها، سهمیه روزانه */
export async function PUT(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'بدنه درخواست نامعتبر است' }, { status: 400 })
  }
  const school = await db.school.findUnique({ where: { id: body.id }, select: { id: true } })
  if (!school) return NextResponse.json({ error: 'مدرسه یافت نشد' }, { status: 404 })

  let limit: number | null = null
  if (body.dailyMessageLimit !== null && body.dailyMessageLimit !== undefined) {
    const n = Number(body.dailyMessageLimit)
    if (!Number.isFinite(n) || n < 1 || n > 1000) {
      return NextResponse.json({ error: 'سهمیه روزانه باید عددی بین ۱ تا ۱۰۰۰ یا خالی باشد' }, { status: 400 })
    }
    limit = Math.trunc(n)
  }

  const data = {
    enabled: body.enabled === true,
    managerEnabled: body.managerEnabled === true,
    dailyMessageLimit: limit,
  }
  const setting = await db.aiSchoolSetting.upsert({
    where: { schoolId: school.id },
    update: data,
    create: { schoolId: school.id, ...data },
  })

  return NextResponse.json({
    ok: true,
    setting: {
      schoolId: setting.schoolId,
      enabled: setting.enabled,
      managerEnabled: setting.managerEnabled,
      dailyMessageLimit: setting.dailyMessageLimit,
    },
  })
}
