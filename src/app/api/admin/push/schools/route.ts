import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { parseFeatures } from '@/lib/features'

/** GET /api/admin/push/schools — وضعیت پوش هر مدرسه (فقط مدیر کل) */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const schools = await db.school.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      isActive: true,
      features: true,
      _count: { select: { users: true } },
    },
  })

  // تعداد اشتراک فعال هر مدرسه برای نمایش
  const schoolIds = schools.map((s) => s.id)
  const subCounts = await db.pushSubscription.groupBy({
    by: ['userId'],
    _count: { _all: true },
    where: { user: { schoolId: { in: schoolIds } } },
  })
  const users = await db.user.findMany({
    where: { id: { in: subCounts.map((s) => s.userId) } },
    select: { id: true, schoolId: true },
  })
  const perSchool = new Map<string, number>()
  for (const s of subCounts) {
    const u = users.find((x) => x.id === s.userId)
    if (u?.schoolId) perSchool.set(u.schoolId, (perSchool.get(u.schoolId) ?? 0) + s._count._all)
  }

  return NextResponse.json({
    schools: schools.map((s) => ({
      id: s.id,
      name: s.name,
      isActive: s.isActive,
      push: parseFeatures(s.features).push,
      users: s._count.users,
      subscriptions: perSchool.get(s.id) ?? 0,
    })),
  })
}

/** PUT /api/admin/push/schools — فعال/غیرفعال‌کردن پوش برای یک مدرسه */
export async function PUT(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body.schoolId !== 'string' || typeof body.enabled !== 'boolean')
    return jsonError('درخواست نامعتبر است')

  const school = await db.school.findUnique({ where: { id: body.schoolId } })
  if (!school) return jsonError('مدرسه یافت نشد', 404)

  // فقط کلید push در features تغییر می‌کند؛ بقیه کلیدها دست‌نخورده می‌مانند
  let features: Record<string, unknown> = {}
  try {
    features = JSON.parse(school.features ?? '{}')
  } catch {
    features = {}
  }
  features.push = body.enabled

  await db.school.update({
    where: { id: school.id },
    data: { features: JSON.stringify(features) },
  })

  return NextResponse.json({ ok: true, schoolId: school.id, push: body.enabled })
}
