'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bell,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Send,
  CheckCircle2,
  XCircle,
  KeyRound,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { faDateTime, faNum } from '@/lib/format'
import { PushSettingsCard } from '@/components/push/push-settings-card'

interface Stats {
  subscriptions: number
  byStatus: { SENT: number; FAILED: number; EXPIRED: number; SKIPPED: number; PENDING: number }
  last7d: { SENT: number; FAILED: number }
}

interface AdminPushData {
  vapidConfigured: boolean
  vapidSubject: string | null
  platformEnabled: boolean
  stats: Stats
  recent: { id: string; type: string; status: string; lastError: string | null; attempts: number; createdAt: string }[]
}

interface SchoolRow {
  id: string
  name: string
  isActive: boolean
  push: boolean
  users: number
  subscriptions: number
}

const STATUS_FA: Record<string, string> = {
  SENT: 'ارسال‌شده',
  FAILED: 'ناموفق',
  EXPIRED: 'منقضی',
  SKIPPED: 'ردشده',
  PENDING: 'در صف',
}

/** بخش «اعلان‌ها» پنل مدیر کل — کلیدهای پلتفرم، وضعیت مدارس، آمار و خطاهای عمومی */
export function AdminPushClient() {
  const { toast } = useToast()
  const [data, setData] = useState<AdminPushData | null>(null)
  const [schools, setSchools] = useState<SchoolRow[] | null>(null)
  const [toggling, setToggling] = useState(false)
  const [busySchool, setBusySchool] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        fetch('/api/admin/push', { cache: 'no-store' }),
        fetch('/api/admin/push/schools', { cache: 'no-store' }),
      ])
      if (a.ok) setData(await a.json())
      if (s.ok) {
        const d = await s.json()
        setSchools(d.schools)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function togglePlatform(on: boolean) {
    setToggling(true)
    try {
      const res = await fetch('/api/admin/push', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformEnabled: on }),
      })
      if (res.ok) {
        setData((d) => (d ? { ...d, platformEnabled: on } : d))
        toast({
          title: on ? 'پوش پلتفرم فعال شد' : 'پوش پلتفرم غیرفعال شد',
          description: on ? 'ارسال صف از این لحظه ادامه می‌یابد.' : 'اعلان‌های درون‌برنامه‌ای همچنان کار می‌کنند.',
        })
      } else {
        toast({ title: 'تغییر وضعیت ناموفق بود', variant: 'destructive' })
      }
    } finally {
      setToggling(false)
    }
  }

  async function toggleSchool(school: SchoolRow, on: boolean) {
    setBusySchool(school.id)
    try {
      const res = await fetch('/api/admin/push/schools', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schoolId: school.id, enabled: on }),
      })
      if (res.ok) {
        setSchools((prev) => (prev ?? []).map((s) => (s.id === school.id ? { ...s, push: on } : s)))
      } else {
        toast({ title: 'تغییر وضعیت مدرسه ناموفق بود', variant: 'destructive' })
      }
    } finally {
      setBusySchool(null)
    }
  }

  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold">اعلان‌ها</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          پوش نوتیفیکیشن واقعی مرورگر (Web Push) — کلیدهای پلتفرم، مدارس و آمار ارسال
        </p>
      </div>

      {/* پیکربندی */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-primary" />
            پیکربندی
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5 gap-2">
            <div>
              <div className="text-sm font-medium">پوش نوتیفیکیشن در سطح پلتفرم</div>
              <div className="text-xs text-muted-foreground">
                خاموش‌کردن آن ارسال‌ها را برای همه مدارس متوقف می‌کند؛ اعلان‌های درون‌برنامه‌ای کار می‌کنند
              </div>
            </div>
            <Switch
              checked={data.platformEnabled}
              disabled={toggling || !data.vapidConfigured}
              onCheckedChange={togglePlatform}
              aria-label="پوش پلتفرم"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div className="flex items-center gap-2">
              {data.vapidConfigured ? (
                <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" />
              ) : (
                <ShieldAlert className="h-4.5 w-4.5 text-red-500" />
              )}
              <div>
                <div className="text-sm font-medium">کلیدهای VAPID</div>
                <div className="text-xs text-muted-foreground">
                  {data.vapidConfigured
                    ? `پیکربندی‌شده (${data.vapidSubject ?? '—'}) — کلید خصوصی فقط در تنظیمات امن سرور نگهداری می‌شود و نمایش داده نمی‌شود`
                    : 'تنظیم نشده — فایل .env سرور را طبق README-DEPLOY تکمیل کنید. تا آن زمان پوش کار نمی‌کند.'}
                </div>
              </div>
            </div>
            <Badge variant={data.vapidConfigured ? 'default' : 'destructive'}>
              {data.vapidConfigured ? 'آماده' : 'ناقص'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* مدارس */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4.5 w-4.5 text-primary" />
            وضعیت مدارس
          </CardTitle>
          <CardDescription>فعال/غیرفعال‌بودن پوش به تفکیک مدرسه</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {schools === null ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : schools.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">هنوز مدرسه‌ای ثبت نشده است</p>
          ) : (
            schools.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border px-3 py-2.5 gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                    {s.name}
                    {!s.isActive && (
                      <Badge variant="outline" className="text-[10px]">
                        مدرسه غیرفعال
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {faNum(s.users)} کاربر — {faNum(s.subscriptions)} اشتراک فعال پوش
                  </div>
                </div>
                <Switch
                  checked={s.push}
                  disabled={busySchool === s.id}
                  onCheckedChange={(v) => toggleSchool(s, v)}
                  aria-label={`پوش ${s.name}`}
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* آمار */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4.5 w-4.5 text-primary" />
            آمار ارسال
          </CardTitle>
          <CardDescription>
            بدون هیچ محتوای خصوصی — فقط نوع رویداد، نتیجه و خطای عمومی
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <StatBox label="اشتراک‌های فعال" value={data.stats.subscriptions} />
            {(['SENT', 'FAILED', 'EXPIRED', 'SKIPPED', 'PENDING'] as const).map((k) => (
              <StatBox key={k} label={STATUS_FA[k]} value={data.stats.byStatus[k]} muted={k !== 'SENT'} />
            ))}
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">۷ روز گذشته — موفق: </span>
              <span className="font-bold">{faNum(data.stats.last7d.SENT)}</span>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <span className="text-muted-foreground">۷ روز گذشته — ناموفق: </span>
              <span className="font-bold">{faNum(data.stats.last7d.FAILED)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* خطاهای عمومی اخیر */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="h-4.5 w-4.5 text-muted-foreground" />
            خطاهای عمومی اخیر
          </CardTitle>
          <CardDescription>ارسال‌های ناموفق/منقضی — بدون endpoint، کلید یا متن اعلان</CardDescription>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-1">خطایی ثبت نشده است</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {data.recent.map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
                  <span className={`shrink-0 flex items-center gap-1 ${r.status === 'FAILED' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                    {r.status === 'FAILED' ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {STATUS_FA[r.status] ?? r.status}
                  </span>
                  <span className="font-medium">{r.type}</span>
                  <span className="text-muted-foreground truncate flex-1">{r.lastError ?? '—'}</span>
                  <span className="text-muted-foreground shrink-0">{faDateTime(r.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* اشتراک شخصی مدیر کل */}
      <PushSettingsCard />
    </div>
  )
}

function StatBox({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${muted ? 'bg-muted/30' : ''}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5">{faNum(value)}</div>
    </div>
  )
}
