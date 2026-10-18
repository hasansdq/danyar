import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { ensureViolationTypes } from '@/lib/seed-data'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/violation-types — مدیریت انواع تخلف (درخواست کاربر — پنل مدیر کل)
 * همهٔ گزینه‌ها (فعال و غیرفعال) + تعداد تخلف ثبت‌شدهٔ هر برچسب (متن رکوردها).
 */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  try {
    await ensureViolationTypes(db)
  } catch {
    /* ignore */
  }

  const [types, usage] = await Promise.all([
    db.violationType.findMany({
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    }),
    db.studentViolation.groupBy({
      by: ['text'],
      _count: { _all: true },
    }),
  ])
  const usageMap = new Map(usage.map((u) => [u.text, u._count._all]))

  return NextResponse.json({
    types: types.map((t) => ({
      id: t.id,
      label: t.label,
      isActive: t.isActive,
      sortOrder: t.sortOrder,
      usageCount: usageMap.get(t.label) ?? 0,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  })
}

/**
 * POST /api/admin/violation-types — افزودن گزینهٔ جدید { label }
 * برچسب یکتا، حداقل ۲ و حداکثر ۱۲۰ کاراکتر؛ ترتیب = انتهای فهرست.
 */
export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('بدنه درخواست نامعتبر است', 400)
  }
  const label = String((body as { label?: unknown }).label ?? '').trim().replace(/\s+/g, ' ')
  if (label.length < 2) return jsonError('برچسب تخلف حداقل ۲ کاراکتر است', 400)
  if (label.length > 120) return jsonError('برچسب تخلف حداکثر ۱۲۰ کاراکتر است', 400)

  const dup = await db.violationType.findUnique({ where: { label } })
  if (dup) return jsonError('گزینه‌ای با همین برچسب وجود دارد', 409)

  const maxOrder = await db.violationType.aggregate({ _max: { sortOrder: true } })
  const created = await db.violationType.create({
    data: { label, sortOrder: (maxOrder._max.sortOrder ?? 0) + 1 },
  })

  return NextResponse.json(
    {
      type: {
        id: created.id,
        label: created.label,
        isActive: created.isActive,
        sortOrder: created.sortOrder,
        usageCount: 0,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    },
    { status: 201 },
  )
}
