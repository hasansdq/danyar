import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import type { Prisma } from '@prisma/client'
import { MEDIA_FORMAT_KEYS, type MediaFormatKey } from '@/lib/media'

export const runtime = 'nodejs'

/**
 * GET /api/admin/media — گالری رسانه‌های کل پلتفرم (فقط مدیر کل)
 *
 * فیلترها: schoolId، type (IMAGE/AUDIO/VIDEO/FILE)، fmt (فرمت/پسوند یا mime)،
 *          minSize/maxSize (بایت)، from/to (تاریخ ایجاد)، q (جست‌وجوی نام)
 * مرتب‌سازی: sort=createdAt|size × order=asc|desc
 * صفحه‌بندی: page، pageSize (حداکثر ۱۰۰)
 * خروجی: آیتم‌ها + آپلودکننده + مدرسه + تعداد دانلود + جمع فیلتر جاری و کل پلتفرم
 */
export async function GET(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const sp = req.nextUrl.searchParams

  const where: Prisma.UploadWhereInput = {}

  const schoolId = sp.get('schoolId')?.trim()
  if (schoolId) where.schoolId = schoolId

  const type = sp.get('type')?.trim() ?? ''
  if (type) {
    if (!MEDIA_FORMAT_KEYS.includes(type as MediaFormatKey)) {
      return jsonError('نوع رسانه نامعتبر است')
    }
    where.type = type
  }

  // فرمت/پسوند یا mime — مثلاً «pdf» یا «image/png»
  const fmt = sp.get('fmt')?.trim().toLowerCase()
  if (fmt) {
    const escaped = fmt.replace(/[%_]/g, (c) => `\\${c}`)
    where.OR = [
      { mime: { contains: escaped } },
      { name: { endsWith: `.${escaped}` } },
      { name: { endsWith: `.${escaped.toUpperCase()}` } },
    ]
  }

  const minSize = Number(sp.get('minSize') ?? '')
  if (Number.isFinite(minSize) && minSize > 0) where.size = { ...(where.size as object), gte: minSize }
  const maxSize = Number(sp.get('maxSize') ?? '')
  if (Number.isFinite(maxSize) && maxSize > 0) where.size = { ...(where.size as object), lte: maxSize }

  // بازه تاریخ ایجاد — from از ابتدای روز، to تا انتهای روز
  const from = sp.get('from')
  if (from) {
    const d = new Date(from)
    if (Number.isNaN(d.getTime())) return jsonError('تاریخ شروع نامعتبر است')
    where.createdAt = { ...(where.createdAt as object), gte: d }
  }
  const to = sp.get('to')
  if (to) {
    const d = new Date(to)
    if (Number.isNaN(d.getTime())) return jsonError('تاریخ پایان نامعتبر است')
    d.setHours(23, 59, 59, 999)
    where.createdAt = { ...(where.createdAt as object), lte: d }
  }

  // جست‌وجوی نام
  const q = sp.get('q')?.trim()
  if (q) where.name = { contains: q }

  // مرتب‌سازی — فقط دو فیلد مجاز برای جلوگیری از تزریق
  const sortField = sp.get('sort') === 'size' ? 'size' : 'createdAt'
  const order = sp.get('order') === 'asc' ? 'asc' : 'desc'

  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? 20) || 20))

  const [items, filteredCount, filteredSum, platformCount, platformSum] = await Promise.all([
    db.upload.findMany({
      where,
      orderBy: { [sortField]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        key: true,
        name: true,
        mime: true,
        size: true,
        type: true,
        downloadCount: true,
        createdAt: true,
        uploader: { select: { id: true, fullName: true, role: true } },
        school: { select: { id: true, name: true } },
      },
    }),
    db.upload.count({ where }),
    db.upload.aggregate({ where, _sum: { size: true } }),
    db.upload.count({}),
    db.upload.aggregate({ _sum: { size: true } }),
  ])

  return NextResponse.json({
    items,
    page,
    pageSize,
    total: filteredCount,
    summary: { count: filteredCount, sizeBytes: filteredSum._sum.size ?? 0 },
    platform: { count: platformCount, sizeBytes: platformSum._sum.size ?? 0 },
  })
}
