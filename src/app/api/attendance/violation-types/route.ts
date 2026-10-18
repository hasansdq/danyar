import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { ensureViolationTypes } from '@/lib/seed-data'

export const dynamic = 'force-dynamic'

/**
 * GET /api/attendance/violation-types — فهرست انواع تخلف فعال برای فهرست کشویی
 * چندانتخابی ثبت تخلف (درخواست کاربر). اگر هیچ گزینه‌ای تعریف نشده باشد،
 * فهرست پیش‌فرض به‌صورت خودکار ساخته می‌شود (خودترمیم پیکربندی).
 * مدیریت کامل (افزودن/غیرفعال‌کردن/حذف) در پنل مدیر کل: /api/admin/violation-types
 */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response

  try {
    await ensureViolationTypes(db)
  } catch {
    // اگر به هر دلیل ساخته نشد، فهرست خالی برگردد — رابط خطای خودش را نشان می‌دهد
  }

  const types = await db.violationType.findMany({
    where: { isActive: true },
    select: { id: true, label: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  })

  return NextResponse.json({ types })
}
