'use client'

/**
 * صفحهٔ جزئیات مدرسه در «مدیریت کلاس‌های آنلاین»:
 * - تنظیمات اختصاصی (فعال/غیرفعال کلاس آنلاین، سقف افراد هر جلسه با تأکید
 *   «معلم نیز جزو ظرفیت»، سقف جلسات هم‌زمان) — ذخیره در دیتابیس
 * - ظرفیت اختصاصی هر کلاس در محدودهٔ سقف مدرسه
 * - جلسات فعال (با افراد حاضر لحظه‌ای) + تاریخچهٔ جلسات (صفحه‌بندی)
 * - آمار همان مدرسه با تعریف شاخص‌ها و منبع داده
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from '@/hooks/use-toast'
import { faNum, faDateTime } from '@/lib/format'
import {
  ArrowRight,
  Settings2,
  CheckCircle2,
  Loader2,
  Users,
  Video,
  History,
  GraduationCap,
  AlertTriangle,
  Info,
} from 'lucide-react'
import {
  type SchoolDetailData,
  OnlineClassBadge,
  capLabel,
  concurrentLabel,
  fmtDurationMin,
} from './oc-shared'

const POLL_MS = 30_000

export function SchoolDetailView({
  schoolId,
  onBack,
  onOpenSession,
}: {
  schoolId: string
  onBack: () => void
  onOpenSession: (sessionId: string) => void
}) {
  const [data, setData] = useState<SchoolDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyPage, setHistoryPage] = useState(1)
  const [saving, setSaving] = useState(false)

  // فرم تنظیمات
  const [onlineClass, setOnlineClass] = useState(true)
  const [capInput, setCapInput] = useState('')
  const [concurrentInput, setConcurrentInput] = useState('')
  const [dirty, setDirty] = useState(false)

  // ویرایش ظرفیت کلاس
  const [capEditId, setCapEditId] = useState<string | null>(null)
  const [classCapValue, setClassCapValue] = useState('')
  const [savingClassCap, setSavingClassCap] = useState(false)

  const fetchDetail = useCallback(
    async (silent: boolean) => {
      try {
        const r = await fetch(
          `/api/superadmin/online-classes/schools/${schoolId}?historyPage=${historyPage}`,
          { cache: 'no-store' },
        )
        if (!r.ok) {
          throw new Error((await r.json().catch(() => null)?.error) ?? `کد ${r.status}`)
        }
        const d = (await r.json()) as SchoolDetailData
        setData(d)
        setError(null)
        if (!silent && !dirty) {
          setOnlineClass(d.school.onlineClass)
          setCapInput(d.school.liveMaxParticipants === null ? '' : String(d.school.liveMaxParticipants))
          setConcurrentInput(d.school.liveMaxConcurrent === null ? '' : String(d.school.liveMaxConcurrent))
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'دریافت جزئیات مدرسه ناموفق بود')
      }
    },
    [schoolId, historyPage, dirty],
  )

  useEffect(() => {
    void fetchDetail(false)
  }, [fetchDetail])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchDetail(true)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [fetchDetail])

  const saveSettings = async () => {
    if (!data) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { onlineClass }
      body.liveMaxParticipants = capInput.trim() === '' ? null : Number(capInput.trim())
      body.liveMaxConcurrent = concurrentInput.trim() === '' ? null : Number(concurrentInput.trim())
      const r = await fetch(`/api/superadmin/online-classes/schools/${schoolId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        toast({
          title: 'ذخیره تنظیمات ناموفق بود',
          description: d?.error ?? `کد ${r.status}`,
          variant: 'destructive',
        })
        return
      }
      toast({
        title: 'تنظیمات کلاس آنلاین مدرسه ذخیره شد',
        description:
          'تنظیمات در دیتابیس ذخیره شد و پس از ری‌استارت باقی می‌ماند. جلسات جاری قطع نشده‌اند — تغییرها روی ورود/ایجاد جدید اعمال می‌شود.',
      })
      if (d?.classroomsAboveCapNote) {
        toast({ title: 'نکتهٔ ظرفیت کلاس‌ها', description: d.classroomsAboveCapNote })
      }
      setDirty(false)
      await fetchDetail(true)
    } finally {
      setSaving(false)
    }
  }

  const saveClassCapacity = async (classroomId: string) => {
    setSavingClassCap(true)
    try {
      const r = await fetch('/api/admin/classrooms', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId,
          capacity: classCapValue.trim() === '' ? null : Number(classCapValue.trim()),
        }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        toast({
          title: 'ذخیره ظرفیت کلاس ناموفق بود',
          description: d?.error ?? `کد ${r.status}`,
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'ظرفیت کلاس ذخیره شد' })
      setCapEditId(null)
      await fetchDetail(true)
    } finally {
      setSavingClassCap(false)
    }
  }

  if (error && !data) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowRight className="h-4 w-4" />
          بازگشت به فهرست
        </Button>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  const schoolCap = data.school.liveMaxParticipants
  const historyTotalPages = Math.max(1, Math.ceil(data.history.total / data.history.pageSize))

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* سربرگ */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowRight className="h-4 w-4" />
          بازگشت به فهرست
        </Button>
        <h1 className="text-xl font-bold flex items-center gap-2">
          {data.school.name}
          <OnlineClassBadge enabled={data.school.onlineClass} />
        </h1>
      </div>

      {/* تنظیمات اختصاصی مدرسه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4.5 w-4.5 text-primary" />
            تنظیمات کلاس آنلاین این مدرسه
          </CardTitle>
          <CardDescription>
            تنظیمات در دیتابیس ذخیره می‌شود و پس از ری‌استارت باقی می‌ماند. اعمال
            محدودیت‌ها در API، سرویس سوکت و مسیر ورود LiveKit انجام می‌شود — محدودکردن
            رابط کاربری به‌تنهایی کافی نیست.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* فعال/غیرفعال */}
          <div className="flex items-start justify-between gap-4 rounded-xl border p-3.5">
            <div className="space-y-1">
              <Label htmlFor="oc-switch" className="text-sm font-semibold">
                قابلیت کلاس آنلاین
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                غیرفعال‌کردن، ایجاد جلسهٔ جدید و ورود جدید را مسدود می‌کند؛ جلسات جاری
                بدون اقدام صریح شما (پایان اجباری) قطع نمی‌شوند.
              </p>
            </div>
            <Switch
              id="oc-switch"
              checked={onlineClass}
              onCheckedChange={(v) => {
                setOnlineClass(v)
                setDirty(true)
              }}
            />
          </div>

          {/* سقف افراد هر جلسه */}
          <div className="rounded-xl border p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <Label htmlFor="cap-input" className="text-sm font-semibold">
                  سقف افراد هم‌زمان هر جلسه
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="font-medium text-foreground">
                    معلم (میزبان) نیز جزو این ظرفیت محسوب می‌شود.
                  </span>{' '}
                  ظرفیت اختصاصی هر کلاس در محدودهٔ همین سقف تعیین می‌شود.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="cap-input"
                  value={capInput}
                  onChange={(e) => {
                    setCapInput(e.target.value.replace(/[^0-9]/g, ''))
                    setDirty(true)
                  }}
                  placeholder={`پیش‌فرض ${faNum(data.limits.globalMaxParticipants)}`}
                  inputMode="numeric"
                  className="h-9 w-28 text-center"
                  aria-label="سقف افراد هم‌زمان هر جلسه"
                />
                <span className="text-xs text-muted-foreground">نفر</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              خالی = سقف سراسری ({faNum(data.limits.globalMaxParticipants)} نفر). این سقف
              محدودیت نرم‌افزاری ورود است و{' '}
              <span className="font-medium">تضمین توان سخت‌افزاری برای آن تعداد کاربر نیست</span>.
            </p>
          </div>

          {/* سقف جلسات هم‌زمان */}
          <div className="rounded-xl border p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <Label htmlFor="concurrent-input" className="text-sm font-semibold">
                  حداکثر جلسات هم‌زمان این مدرسه
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ایجاد جلسهٔ جدید پس از پرشدن سقف مسدود می‌شود (در هر کلاس همچنان فقط
                  یک جلسه فعال).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id="concurrent-input"
                  value={concurrentInput}
                  onChange={(e) => {
                    setConcurrentInput(e.target.value.replace(/[^0-9]/g, ''))
                    setDirty(true)
                  }}
                  placeholder="نامحدود"
                  inputMode="numeric"
                  className="h-9 w-28 text-center"
                  aria-label="حداکثر جلسات هم‌زمان"
                />
                <span className="text-xs text-muted-foreground">جلسه</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              خالی = نامحدود. سقف مؤثر فعلی:{' '}
              {concurrentLabel(
                data.school.liveMaxConcurrent === null && data.limits.effectiveMaxConcurrent > 0
                  ? data.limits.effectiveMaxConcurrent
                  : data.school.liveMaxConcurrent,
              )}
              {data.limits.effectiveMaxConcurrent > 0 && data.school.liveMaxConcurrent === null
                ? ' (سقف سراسری)'
                : ''}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-foreground">
              وضعیت فعلی ذخیره‌شده: سقف هر جلسه{' '}
              {capLabel(schoolCap, `پیش‌فرض ${faNum(data.limits.effectiveSessionCap)} نفر`)} —
              سقف هم‌زمان {concurrentLabel(data.school.liveMaxConcurrent)}
            </p>
            <Button onClick={saveSettings} disabled={saving || !dirty} className="gap-1.5">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              ذخیرهٔ تنظیمات
            </Button>
          </div>

          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/60 rounded-lg p-2.5 leading-relaxed">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
            <span>
              کاهش سقف، افراد حاضر را اخراج نمی‌کند؛ تا کاهش تعداد افراد، فقط ورود جدید
              مسدود می‌شود. خروج/قطع/اتصال مجدد و پایان جلسه با شمارش واقعی ظرفیت
              هماهنگ است.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* جلسات فعال */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Video className="h-4.5 w-4.5 text-primary" />
            جلسات فعال
            <Badge variant="secondary" className="text-[11px]">
              {faNum(data.activeSessions.length)} جلسه
            </Badge>
          </CardTitle>
          <CardDescription>
            شمار افراد حاضر از حافظهٔ زندهٔ سرویس سوکت می‌آید (اگر جلسه در حافظه
            نباشد، از گزارش دیتابیس) — منبع هر ردیف نمایش داده می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.activeSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              هیچ جلسهٔ فعالی در این مدرسه در جریان نیست.
            </p>
          ) : (
            <div className="space-y-2">
              {data.activeSessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onOpenSession(s.id)}
                  className="w-full text-right rounded-xl border bg-card hover:bg-accent/60 transition-colors p-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-sm truncate">{s.title}</span>
                      {s.announcedAt ? (
                        <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                          اعلام‌شده
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          در حال آماده‌سازی
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {faDateTime(s.startedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-xs">
                    <span className="text-muted-foreground">
                      کلاس: <span className="font-medium text-foreground">{s.classroom.name}</span>
                    </span>
                    <span className="text-muted-foreground">
                      معلم: <span className="font-medium text-foreground">{s.host.name}</span>
                    </span>
                    <span className="text-muted-foreground">
                      حاضرین:{' '}
                      <span className="font-bold text-foreground tabular-nums">
                        {faNum(s.onlineCount)}/{faNum(s.maxParticipants)}
                      </span>
                    </span>
                    {s.hostConnected === true && (
                      <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                        میزبان متصل
                      </Badge>
                    )}
                    {s.hostConnected === false && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                        میزبان قطع (مهلت اتصال مجدد)
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground/80 mt-1.5">
                    منبع شمارش: {s.onlineCountSource}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* کلاس‌ها و ظرفیت اختصاصی */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-4.5 w-4.5 text-primary" />
            ظرفیت اختصاصی کلاس‌ها
          </CardTitle>
          <CardDescription>
            ظرفیت هر کلاس در محدودهٔ سقف مجاز مدرسه تعیین می‌شود. «ظرفیت مؤثر» =
            حداقلِ سقف مدرسه و ظرفیت کلاس (خالی = سقف مدرسه/سراسری).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-96">
            {data.classrooms.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                این مدرسه هنوز کلاسی ندارد.
              </p>
            ) : (
              <div className="divide-y pr-1">
                {data.classrooms.map((c) => (
                  <div key={c.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <span className="font-medium text-sm">{c.name}</span>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {faNum(c.students)} دانش‌آموز — {faNum(c.groups)} گروه درسی
                      </div>
                    </div>
                    <div className="flex gap-2 items-center flex-wrap">
                      <Badge variant="outline" className="text-[11px] gap-1">
                        <Users className="h-3 w-3" />
                        ظرفیت مؤثر: {faNum(c.effectiveCapacity)} نفر
                      </Badge>
                      {capEditId === c.id ? (
                        <div className="flex items-center gap-1.5">
                          <Input
                            value={classCapValue}
                            onChange={(e) => setClassCapValue(e.target.value.replace(/[^0-9]/g, ''))}
                            placeholder="خالی = سقف مدرسه"
                            inputMode="numeric"
                            className="h-8 w-24 text-center"
                            aria-label={`ظرفیت کلاس آنلاین ${c.name}`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveClassCapacity(c.id)
                              if (e.key === 'Escape') setCapEditId(null)
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-8 px-2.5"
                            disabled={
                              savingClassCap ||
                              (classCapValue.trim() !== '' &&
                                (Number(classCapValue) < 2 ||
                                  Number(classCapValue) > 500 ||
                                  (schoolCap !== null && Number(classCapValue) > schoolCap)))
                            }
                            onClick={() => void saveClassCapacity(c.id)}
                          >
                            {savingClassCap ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            ذخیره
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => setCapEditId(null)}
                          >
                            انصراف
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Badge variant="secondary" className="text-[11px]">
                            {c.capacity ? `ظرفیت اختصاصی: ${faNum(c.capacity)}` : 'بدون ظرفیت اختصاصی'}
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1.5 text-[12px]"
                            onClick={() => {
                              setCapEditId(c.id)
                              setClassCapValue(c.capacity === null ? '' : String(c.capacity))
                            }}
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                            ظرفیت
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* تاریخچه جلسات */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4.5 w-4.5 text-primary" />
            تاریخچهٔ جلسات
            <Badge variant="secondary" className="text-[11px]">
              {faNum(data.history.total)} جلسهٔ برگزارشده
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.history.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              هنوز جلسه‌ای برگزار نشده است.
            </p>
          ) : (
            <div className="space-y-2">
              <ScrollArea className="max-h-96">
                <div className="space-y-2 pr-1">
                  {data.history.sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onOpenSession(s.id)}
                      className="w-full text-right rounded-xl border bg-card hover:bg-accent/60 transition-colors p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm truncate">{s.title}</span>
                          {s.forceEnded && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-red-500/40 text-red-600 dark:text-red-400 gap-1"
                              title={s.forceEndReason ?? undefined}
                            >
                              <AlertTriangle className="h-3 w-3" />
                              پایان اجباری
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {faDateTime(s.startedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-1.5 text-xs text-muted-foreground">
                        <span>
                          کلاس: <span className="font-medium text-foreground">{s.classroomName}</span>
                        </span>
                        <span>
                          معلم: <span className="font-medium text-foreground">{s.hostName}</span>
                        </span>
                        <span>
                          مدت:{' '}
                          <span className="font-medium text-foreground">
                            {fmtDurationMin(s.durationMin)}
                          </span>
                        </span>
                        <span>
                          شرکت‌کنندگان: <span className="font-medium text-foreground">{faNum(s.participants)}</span>
                        </span>
                      </div>
                      {s.forceEnded && s.forceEndReason && (
                        <div className="text-[11px] text-red-600/90 dark:text-red-400/90 mt-1">
                          دلیل پایان اجباری{s.enderName ? ` (توسط ${s.enderName})` : ''}:{' '}
                          {s.forceEndReason}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
              {/* صفحه‌بندی تاریخچه */}
              {historyTotalPages > 1 && (
                <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
                  <span className="text-xs text-muted-foreground">
                    صفحهٔ {faNum(data.history.page)} از {faNum(historyTotalPages)}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    >
                      قبلی
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={historyPage >= historyTotalPages}
                      onClick={() => setHistoryPage((p) => p + 1)}
                    >
                      بعدی
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* آمار مدرسه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4.5 w-4.5 text-primary" />
            آمار این مدرسه (۳۰ روز گذشته)
          </CardTitle>
          <CardDescription>
            همهٔ شاخص‌ها از دادهٔ واقعی محاسبه می‌شوند؛ تعریف و منبع هر شاخص زیر آن
            آمده است. شاخص بدون منبع واقعی «در دسترس نیست» نمایش داده می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            <MiniStat
              label="جلسات برگزارشده"
              value={faNum(data.stats.heldSessions)}
              source={data.stats.sources.heldSessions}
            />
            <MiniStat
              label="افراد حاضر"
              value={faNum(data.stats.presentUsers)}
              source={data.stats.sources.presentUsers}
            />
            <MiniStat
              label="بیشترین حضور هم‌زمان"
              value={
                data.stats.peakAttendance
                  ? `${faNum(data.stats.peakAttendance.value)}${data.stats.peakAttendance.approximate ? ' (تقریبی)' : ''}`
                  : 'در دسترس نیست'
              }
              source={data.stats.sources.peakAttendance}
            />
            <MiniStat
              label="مجموع مدت جلسات"
              value={fmtDurationMin(data.stats.totalDurationMin)}
              source={data.stats.sources.duration}
            />
            <MiniStat
              label="قطع‌ووصل ثبت‌شده"
              value={faNum(data.stats.reconnects)}
              source={data.stats.sources.reconnects}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MiniStat({ label, value, source }: { label: string; value: string; source?: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 space-y-1" title={source ?? undefined}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-bold tabular-nums leading-tight">{value}</div>
      {source && (
        <div className="text-[10px] text-muted-foreground/80 line-clamp-1">{source}</div>
      )}
    </div>
  )
}
