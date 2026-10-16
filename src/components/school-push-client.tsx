'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Bell,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Megaphone,
  ClipboardList,
  Video,
  BookOpen,
  CalendarCheck,
  Info,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { faNum } from '@/lib/format'
import { PushSettingsCard } from '@/components/push/push-settings-card'
import { MutesCard } from '@/components/push/mutes-card'

interface SchoolPushData {
  vapidConfigured: boolean
  platformEnabled: boolean
  schoolEnabled: boolean
  active: boolean
  subscriptions: number
  stats: { last7d: { SENT: number; FAILED: number } }
}

const TOOLS = [
  { href: '/modir/announcements', label: 'اطلاعیه', icon: Megaphone, desc: 'اطلاعیه رسمی برای گروه‌های انتخابی' },
  { href: '/assignments', label: 'تکلیف', icon: ClipboardList, desc: 'انتشار تکلیف و ثبت بازخورد' },
  { href: '/live', label: 'کلاس آنلاین', icon: Video, desc: 'دعوت به جلسه زنده' },
  { href: '/sample-questions', label: 'نمونه‌سؤال', icon: BookOpen, desc: 'انتشار نمونه‌سؤال برای کلاس‌ها' },
  { href: '/attendance', label: 'حضور و غیاب', icon: CalendarCheck, desc: 'نهایی‌سازی و اصلاح وضعیت' },
]

/**
 * بخش «اعلان‌ها» پنل مدیر مدرسه:
 * - وضعیت پوش مدرسه (تغییر فقط از پنل مدیر کل)
 * - اعلان‌ها فقط از طریق امکانات موجود ساخته می‌شوند (اطلاعیه، تکلیف و …)
 * - فعال‌سازی پوش دستگاه خود مدیر + بی‌صدایی‌ها
 */
export function SchoolPushClient() {
  const [data, setData] = useState<SchoolPushData | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/school/push', { cache: 'no-store' })
        if (res.ok) setData(await res.json())
      } catch {
        /* ignore */
      }
    })()
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold">اعلان‌ها</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          وضعیت پوش مرورگر برای مدرسه شما و راه‌های ایجاد اعلان برای مخاطبان مجاز
        </p>
      </div>

      {/* وضعیت مدرسه */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4.5 w-4.5 text-primary" />
            وضعیت پوش مدرسه
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data === null ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 gap-2">
                <div className="flex items-center gap-2">
                  {data.active ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-amber-500" />
                  )}
                  <div>
                    <div className="text-sm font-medium">
                      {data.active
                        ? 'پوش برای مدرسه شما فعال است'
                        : 'پوش برای مدرسه شما کامل فعال نیست'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {!data.vapidConfigured
                        ? 'کلیدهای سرور تنظیم نشده است — با مدیر پلتفرم تماس بگیرید.'
                        : !data.platformEnabled
                          ? 'پوش در سطح پلتفرم توسط مدیر کل غیرفعال شده است.'
                          : !data.schoolEnabled
                            ? 'پوش برای این مدرسه توسط مدیر کل غیرفعال شده است — از مدیر کل بخواهید آن را فعال کند.'
                            : 'اعضای مدرسه می‌توانند از تنظیمات، اعلان دستگاه خود را فعال کنند.'}
                    </div>
                  </div>
                </div>
                <Badge variant={data.active ? 'default' : 'secondary'}>
                  {data.active ? 'فعال' : 'غیرفعال'}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">اشتراک‌های فعال</div>
                  <div className="text-lg font-bold mt-0.5">{faNum(data.subscriptions)}</div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">۷ روز — موفق</div>
                  <div className="text-lg font-bold mt-0.5">{faNum(data.stats.last7d.SENT)}</div>
                </div>
                <div className="rounded-lg border px-3 py-2">
                  <div className="text-xs text-muted-foreground">۷ روز — ناموفق</div>
                  <div className="text-lg font-bold mt-0.5">{faNum(data.stats.last7d.FAILED)}</div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* منابع ایجاد اعلان */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4.5 w-4.5 text-primary" />
            اعلان‌ها چ ساخته می‌شوند؟
          </CardTitle>
          <CardDescription>
            مدیر مدرسه اعلان جداگانه‌ای ارسال نمی‌کند؛ این امکانات موجود به‌طور خودکار به مخاطبان مجاز
            همین مدرسه اعلان و پوش می‌فرستند:
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-accent transition-colors"
            >
              <t.icon className="h-4.5 w-4.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground truncate">{t.desc}</div>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* دستگاه خود مدیر */}
      <PushSettingsCard />
      <MutesCard />

      <p className="text-xs text-muted-foreground leading-5 px-1">
        توجه: دریافت پوش به پشتیبانی مرورگر و سیستم‌عامل وابسته است و همیشه تضمین نمی‌شود؛
        اعلان‌های درون‌برنامه‌ای مستقل از این تنظیمات همیشه کار می‌کنند.
      </p>
    </div>
  )
}
