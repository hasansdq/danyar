import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { computeOnlineClassesStats } from '@/lib/online-classes'

/**
 * GET /api/superadmin/online-classes/stats?schoolId=&from=&to= — آمار و عملکرد
 * کلاس‌های آنلاین بر اساس مدرسه و بازهٔ زمانی (فقط مدیر کل).
 *
 * - همهٔ شاخص‌ها از دادهٔ واقعی محاسبه می‌شوند؛ شاخص بدون منبع واقعی در
 *   metricsNotAvailable می‌آید تا UI «در دسترس نیست» نمایش دهد (نه صفر ساختگی).
 * - کیفیت اتصال/نرخ بیت/packet loss/تأخیر سمت کلاینت اندازه‌گیری می‌شوند و
 *   منبع سراسری ندارند → در دسترس نیست (جزئیات هر جلسهٔ فعال از LiveKit قابل
 *   مشاهده است، نه این آمار تجمیعی).
 * - CPU/RAM سرور مشترک است و به مدرسه‌ای نسبت داده نمی‌شود (بخش «وضعیت زیرساخت»).
 * - بدون جدول تجمیعی — کوئری‌های on-demand با سقف ردیف؛ رشد نامحدود ندارد.
 */
export async function GET(req: NextRequest) {
  const guard = await guardSuperAdminApi('oc-stats', 60, 60_000)
  if ('response' in guard) return guard.response

  const sp = req.nextUrl.searchParams
  const schoolId = sp.get('schoolId')?.trim() || null
  const fromRaw = sp.get('from')?.trim() || null
  const toRaw = sp.get('to')?.trim() || null
  // بازه‌های سریع: today | 7d | 30d | all (پیش‌فرض 30d)
  const range = sp.get('range')?.trim() || '30d'

  let from: Date | null = null
  let to: Date | null = null
  if (range === 'today') {
    from = new Date()
    from.setHours(0, 0, 0, 0)
  } else if (range === '7d') {
    from = new Date(Date.now() - 7 * 86_400_000)
  } else if (range === '30d' || range === 'all') {
    if (range === '30d') from = new Date(Date.now() - 30 * 86_400_000)
  } else if (fromRaw || toRaw) {
    if (fromRaw) {
      const d = new Date(fromRaw)
      if (!Number.isNaN(d.getTime())) from = d
    }
    if (toRaw) {
      const d = new Date(toRaw)
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999)
        to = d
      }
    }
  } else {
    from = new Date(Date.now() - 30 * 86_400_000)
  }

  if (schoolId) {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { id: true },
    })
    if (!school) return infraJson({ error: 'مدرسه یافت نشد' }, 404)
  }

  const stats = await computeOnlineClassesStats({ schoolId, from, to })
  return infraJson({
    ...stats,
    notAvailableNote: {
      quality:
        'کیفیت اتصال، نرخ بیت، packet loss و تأخیر در مرورگر هر شرکت‌کننده اندازه‌گیری می‌شوند و منبع سرور-جانبی ندارند — برای هر جلسهٔ فعال، وضعیت اتصال LiveKit در جزئیات جلسه قابل مشاهده است',
      resources:
        'مصرف CPU/RAM سرور مشترک است و به مدرسه‌ای نسبت داده نمی‌شود — در بخش «وضعیت زیرساخت»',
    },
  })
}
