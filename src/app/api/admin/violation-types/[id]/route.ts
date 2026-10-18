import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/violation-types/[id] — ویرایش گزینه { label?, isActive? }
 * - تغییر برچسب: رکوردهای تخلف گذشته متن خود را حفظ می‌کنند (سابقه دست‌نخورده)
 * - غیرفعال‌کردن: گزینه از فهرست انتخاب معلم/مدیر حذف می‌شود اما سابقه می‌ماند
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('بدنه درخواست نامعتبر است', 400)
  }
  const b = body as { label?: unknown; isActive?: unknown }

  const existing = await db.violationType.findUnique({ where: { id } })
  if (!existing) return jsonError('گزینه یافت نشد', 404)

  const data: { label?: string; isActive?: boolean } = {}

  if (b.label !== undefined) {
    const label = String(b.label ?? '').trim().replace(/\s+/g, ' ')
    if (label.length < 2) return jsonError('برچسب تخلف حداقل ۲ کاراکتر است', 400)
    if (label.length > 120) return jsonError('برچسب تخلف حداکثر ۱۲۰ کاراکتر است', 400)
    if (label !== existing.label) {
      const dup = await db.violationType.findUnique({ where: { label } })
      if (dup) return jsonError('گزینه‌ای با همین برچسب وجود دارد', 409)
      data.label = label
    }
  }

  if (b.isActive !== undefined) {
    if (typeof b.isActive !== 'boolean') return jsonError('مقدار فعال/غیرفعال نامعتبر است', 400)
    data.isActive = b.isActive
  }

  if (!Object.keys(data).length) return jsonError('تغییری ارسال نشده است', 400)

  const updated = await db.violationType.update({ where: { id }, data })

  return NextResponse.json({
    type: {
      id: updated.id,
      label: updated.label,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  })
}

/**
 * DELETE /api/admin/violation-types/[id]
 * فقط وقتی هیچ تخلفی با این برچسب ثبت نشده باشد؛ در غیر این صورت گزینه باید
 * غیرفعال شود (نه حذف) تا سابقهٔ ثبت‌شده قابل فهم بماند.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const existing = await db.violationType.findUnique({ where: { id } })
  if (!existing) return jsonError('گزینه یافت نشد', 404)

  const usage = await db.studentViolation.count({ where: { text: existing.label } })
  if (usage > 0) {
    return jsonError(
      `با این برچسب ${usage} تخلف ثبت شده است — گزینه را غیرفعال کنید تا سابقه حفظ شود`,
      409,
    )
  }

  await db.violationType.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
