import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import {
  MAX_QUOTA_GB,
  getMediaFormats,
  saveMediaFormats,
  sanitizeMediaFormats,
  schoolUsageBytes,
} from '@/lib/media'

export const runtime = 'nodejs'

/**
 * GET /api/admin/media/settings — تنظیمات رسانه‌ها (فقط مدیر کل)
 * فرمت‌های مجاز + سقف حجم هر فرمت و فهرست مدارس با سهمیه و مصرف فعلی
 */
export async function GET() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const [formats, schools] = await Promise.all([
    getMediaFormats(),
    db.school.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, isActive: true, mediaQuotaGB: true },
    }),
  ])

  const withUsage = await Promise.all(
    schools.map(async (s) => ({
      ...s,
      usageBytes: await schoolUsageBytes(s.id),
      fileCount: await db.upload.count({ where: { schoolId: s.id } }),
    })),
  )

  return NextResponse.json({ formats, schools: withUsage })
}

/**
 * PUT /api/admin/media/settings — ذخیره سیاست آپلود و سهمیه مدارس
 * body: { formats: MediaFormatSetting[], quotas: { [schoolId]: number(GB) } }
 * سهمیه ۰ = نامحدود؛ فقط مدارس موجود و مقادیر عددی معتبر پذیرفته می‌شوند
 */
export async function PUT(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('درخواست نامعتبر است')

  // ─── فرمت‌ها ───
  const formats = sanitizeMediaFormats(body.formats)
  if (!formats) {
    return jsonError('تنظیمات فرمت‌ها نامعتبر است — هر ۴ فرمت با سقف حجم و حداقل یک پسوند لازم است')
  }

  // ─── سهمیه مدارس ───
  const quotas = body.quotas
  if (quotas !== undefined && (typeof quotas !== 'object' || quotas === null || Array.isArray(quotas))) {
    return jsonError('ساختار سهمیه مدارس نامعتبر است')
  }

  let quotaUpdates: { id: string; mediaQuotaGB: number }[] = []
  if (quotas) {
    const entries = Object.entries(quotas as Record<string, unknown>)
    if (entries.length > 200) return jsonError('تعداد سهمیه‌ها بیش از حد مجاز است')
    const ids = entries.map(([id]) => id)
    const existing = await db.school.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    })
    const existingSet = new Set(existing.map((s) => s.id))
    quotaUpdates = []
    for (const [id, value] of entries) {
      if (!existingSet.has(id)) return jsonError('یکی از مدارس یافت نشد')
      const gb = Number(value)
      if (!Number.isFinite(gb) || gb < 0 || gb > MAX_QUOTA_GB) {
        return jsonError('سهمیه باید عددی بین ۰ تا ۴۰۹۶ گیگابایت باشد')
      }
      quotaUpdates.push({ id, mediaQuotaGB: Math.round(gb * 1e6) / 1e6 })
    }
  }

  await saveMediaFormats(formats)
  for (const q of quotaUpdates) {
    await db.school.update({ where: { id: q.id }, data: { mediaQuotaGB: q.mediaQuotaGB } })
  }

  return NextResponse.json({ ok: true, formats, appliedQuotas: quotaUpdates.length })
}
