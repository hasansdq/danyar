import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireSchoolAdmin } from '@/lib/api-auth'
import {
  VICE_PERMISSIONS,
  isVicePermissionKey,
  vicePermissionMap,
} from '@/lib/vice-permissions'

/**
 * GET /api/vice-permissions — فهرست معاون‌های مدرسه + نقشهٔ دسترسی‌های هرکدام
 * فقط مدیر مدرسه (خود معاون‌ها این پنل را نمی‌بینند).
 */
export async function GET() {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  const vices = await db.user.findMany({
    where: { role: 'SCHOOL_VICE', schoolId: session.schoolId },
    select: {
      id: true,
      username: true,
      fullName: true,
      phone: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  const withMaps = await Promise.all(
    vices.map(async (v) => ({
      ...v,
      permissions: await vicePermissionMap(v.id),
    })),
  )

  return NextResponse.json({
    vices: withMaps,
    catalog: VICE_PERMISSIONS,
  })
}

/**
 * PUT /api/vice-permissions — روشن/خاموش کردن یک مجوز یک معاون (سوییچ)
 * بدنه: { viceId, key, enabled }
 * فقط مدیر مدرسه؛ معاون باید متعلق به همان مدرسه باشد.
 */
export async function PUT(req: NextRequest) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const session = res.session

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('بدنه درخواست نامعتبر است', 400)
  }
  const b = body as { viceId?: string; key?: string; enabled?: boolean }

  const viceId = String(b.viceId ?? '')
  const key = String(b.key ?? '')
  const enabled = b.enabled === true

  if (!viceId) return jsonError('معاون مشخص نشده است', 400)
  if (!isVicePermissionKey(key)) return jsonError('کلید مجوز نامعتبر است', 400)

  const vice = await db.user.findUnique({
    where: { id: viceId },
    select: { id: true, role: true, schoolId: true, fullName: true },
  })
  if (!vice || vice.role !== 'SCHOOL_VICE' || vice.schoolId !== session.schoolId) {
    return jsonError('معاون در این مدرسه یافت نشد', 404)
  }

  // upsert — نبود ردیف یعنی روشن (پیش‌فرض)
  await db.vicePermission.upsert({
    where: { viceId_key: { viceId, key } },
    update: { enabled },
    create: { viceId, key, enabled },
  })

  return NextResponse.json({ ok: true, viceId, key, enabled })
}
