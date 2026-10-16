import { NextRequest } from 'next/server'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { schoolsLiveRows } from '@/lib/online-classes'

/**
 * GET /api/superadmin/online-classes/schools — فهرست مدارس با وضعیت کلاس آنلاین
 * (جست‌وجو + فیلتر فعال/غیرفعال + صفحه‌بندی) — فقط مدیر کل، بدون کش، محدود نرخ.
 *
 * برای هر مدرسه: فعال‌بودن قابلیت، سقف افراد هم‌زمان هر جلسه (معلم نیز جزو ظرفیت)،
 * سقف جلسات هم‌زمان، تعداد جلسات فعال و مجموع افراد آنلاین.
 */
export async function GET(req: NextRequest) {
  const guard = await guardSuperAdminApi('oc-schools', 60, 60_000)
  if ('response' in guard) return guard.response

  const sp = req.nextUrl.searchParams
  const q = sp.get('q') ?? ''
  const enabledRaw = sp.get('enabled') ?? 'all'
  const enabled: 'yes' | 'no' | 'all' =
    enabledRaw === 'yes' || enabledRaw === 'no' ? enabledRaw : 'all'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt(sp.get('pageSize') ?? '20') || 20))

  const data = await schoolsLiveRows({ q, enabled, page, pageSize })
  return infraJson({
    ...data,
    note: {
      sessionCap: 'سقف افراد هم‌زمان هر جلسه — معلم نیز جزو ظرفیت محسوب می‌شود؛ محدودیت نرم‌افزاری ورود است و تضمین توان سخت‌افزاری نیست',
      onlineUsersSource: 'دیتابیس — گزارش حضور جلسات فعال (شمارش سوکت)',
    },
  })
}
