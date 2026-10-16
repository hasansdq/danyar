'use client'

/**
 * صفحهٔ «وضعیت زیرساخت» — مدیر کل.
 *
 * - بررسی بک‌اند (سرویس‌ها/منابع) با تازه‌سازی خودکار سبک (۳۰ث) که هنگام
 *   پنهان‌بودن صفحه متوقف می‌شود + دکمهٔ تازه‌سازی دستی
 * - وضعیت قدیمی با برچسب «داده قدیمی» و زمان آخرین داده مشخص می‌شود
 * - دادهٔ ساختگی وجود ندارد: هرچه نمایش داده می‌شود از پاسخ واقعی سرور است
 * - هیچ محرمانه‌ای (کلید/رمز/توکن/رشته اتصال) نمایش داده نمی‌شود
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  RefreshCw,
  ServerCog,
  Globe,
  Database,
  HardDriveUpload,
  MessagesSquare,
  Video,
  RadioTower,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Info,
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { faNum } from '@/lib/format'
import type {
  InfraEvent,
  InfraThresholds,
  ResourcesSnapshot,
  RunModeInfo,
  ServiceCheck,
  AlertState as InfraAlertState,
} from '@/lib/infra/types'
import { STATUS_LABELS } from '@/lib/infra/types'
import { ResourcesPanel } from './infra-resources'
import { BrowserTestsPanel } from './infra-browser-tests'
import { fmtAgo, fmtDateTime, fmtTime, StatusBadge } from './infra-shared'

const POLL_INTERVAL_MS = 30_000
const STALE_AFTER_MS = 75_000 // ~۲.۵ برابر بازهٔ تازه‌سازی

interface OverviewData {
  runMode: RunModeInfo
  appVersion: string
  processStartedAt: number
  generatedAt: number
  checks: ServiceCheck[]
  totalLatencyMs: number
  thresholds: InfraThresholds
}

interface ResourcesData {
  snapshot: ResourcesSnapshot
  alerts: InfraAlertState[]
  thresholds: InfraThresholds
}

interface EventsData {
  events: InfraEvent[]
  policy: { retentionDays: number; hardCap: number; note: string }
}

const SERVICE_ICONS: Record<string, typeof Globe> = {
  web: Globe,
  db: Database,
  upload: HardDriveUpload,
  socket: MessagesSquare,
  livekit: Video,
  turn: RadioTower,
}

export function InfrastructureClient() {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [resources, setResources] = useState<ResourcesData | null>(null)
  const [events, setEvents] = useState<EventsData | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [lastDataAt, setLastDataAt] = useState<number | null>(null)
  const visibleRef = useRef(true)

  const fetchAll = useCallback(async (silent: boolean) => {
    if (!silent) setRefreshing(true)
    const results = await Promise.allSettled([
      fetch('/api/superadmin/infrastructure/overview', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null)?.error) ?? `کد ${r.status}`)
        return (await r.json()) as OverviewData
      }),
      fetch('/api/superadmin/infrastructure/resources', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null)?.error) ?? `کد ${r.status}`)
        return (await r.json()) as ResourcesData
      }),
      fetch('/api/superadmin/infrastructure/events?count=50', { cache: 'no-store' }).then(async (r) => {
        if (!r.ok) throw new Error(`کد ${r.status}`)
        return (await r.json()) as EventsData
      }),
    ])
    const [ov, rs, ev] = results
    if (ov.status === 'fulfilled') {
      setOverview(ov.value)
      setOverviewError(null)
      setLastDataAt(Date.now())
    } else {
      // صفحه خراب نمی‌شود — سرویس‌ها آخرین وضعیت معتبر را نگه می‌دارند + برچسب داده قدیمی
      setOverviewError(ov.reason instanceof Error ? ov.reason.message : 'بررسی سرویس‌ها ناموفق بود')
      toast({
        title: 'تازه‌سازی وضعیت سرویس‌ها ناموفق بود',
        description: 'آخرین دادهٔ معتبر نمایش داده می‌شود',
        variant: 'destructive',
      })
    }
    if (rs.status === 'fulfilled') setResources(rs.value)
    if (ev.status === 'fulfilled') setEvents(ev.value)
    if (!silent) setRefreshing(false)
  }, [])

  // نخستین بار + تازه‌سازی خودکار سبک — فقط وقتی صفحه مرئی است
  useEffect(() => {
    fetchAll(true)
  }, [fetchAll])

  useEffect(() => {
    const onVis = () => {
      visibleRef.current = document.visibilityState === 'visible'
      if (visibleRef.current) {
        setNow(Date.now())
        fetchAll(true) // بازگشت به صفحه = تازه‌سازی فوری
      }
    }
    document.addEventListener('visibilitychange', onVis)
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(tick)
    }
  }, [fetchAll])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(() => {
      if (visibleRef.current && document.visibilityState === 'visible') fetchAll(true)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [autoRefresh, fetchAll])

  const stale = lastDataAt !== null && now - lastDataAt > STALE_AFTER_MS
  const degradedCount = overview?.checks.filter((c) => c.status === 'degraded').length ?? 0

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* ─── سربرگ: حالت اجرا / نسخه / زمان‌ها ─── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <ServerCog className="h-5 w-5 text-primary" />
                وضعیت زیرساخت
                {stale ? (
                  <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-500/40">
                    داده قدیمی
                  </Badge>
                ) : null}
                {degradedCount > 0 ? (
                  <Badge variant="outline" className="text-red-700 dark:text-red-400 border-red-500/40">
                    {faNum(degradedCount)} سرویس با اختلال
                  </Badge>
                ) : overview ? (
                  <Badge variant="outline" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/40">
                    همهٔ سرویس‌های بررسی‌شده سالم
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                مشاهدهٔ وضعیت واقعی سرویس‌ها، منابع و تشخیص محل اختلال — بدون دادهٔ ساختگی؛ وضعیت‌ها فقط از بررسی واقعی می‌آیند.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch id="infra-auto" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
                <Label htmlFor="infra-auto" className="text-xs text-muted-foreground cursor-pointer">
                  تازه‌سازی خودکار
                  <span className="block text-[10px]">هنگام پنهان‌بودن صفحه متوقف می‌شود</span>
                </Label>
              </div>
              <Button size="sm" variant="outline" onClick={() => fetchAll(false)} disabled={refreshing}>
                {refreshing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                تازه‌سازی
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <MetaItem label="حالت اجرا">
              {overview ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{overview.runMode.label}</span>
                  <span className="text-muted-foreground" dir="rtl">
                    ({overview.runMode.source})
                  </span>
                </span>
              ) : (
                <Skeleton className="h-4 w-24" />
              )}
            </MetaItem>
            <MetaItem label="نسخهٔ برنامه">
              {overview ? <span className="font-semibold">{overview.appVersion}</span> : <Skeleton className="h-4 w-16" />}
            </MetaItem>
            <MetaItem label="شروع سرویس وب">
              {overview ? (
                <span className="font-semibold">{fmtDateTime(overview.processStartedAt)}</span>
              ) : (
                <Skeleton className="h-4 w-32" />
              )}
            </MetaItem>
            <MetaItem label="آخرین بررسی">
              {overview ? (
                <span className="font-semibold">
                  {fmtTime(overview.generatedAt)} — {fmtAgo(overview.generatedAt, now)}
                </span>
              ) : (
                <Skeleton className="h-4 w-32" />
              )}
            </MetaItem>
          </div>
          {overviewError ? (
            <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                آخرین تازه‌سازی ناموفق بود: {overviewError} — دادهٔ قبلی با برچسب «داده قدیمی» نمایش داده می‌شود.
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ─── وضعیت سرویس‌ها (بررسی بک‌اند) ─── */}
      <section className="space-y-3" aria-label="وضعیت سرویس‌ها از سمت سرور">
        <h2 className="text-sm font-bold text-muted-foreground">وضعیت سرویس‌ها — بررسی از سمت سرور</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {overview
            ? overview.checks.map((c) => <ServiceCard key={c.key} check={c} stale={stale} now={now} />)
            : Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="pt-6">
                    <Skeleton className="h-20 w-full" />
                  </CardContent>
                </Card>
              ))}
        </div>
      </section>

      {/* ─── منابع ─── */}
      <section className="space-y-3" aria-label="منابع سرور">
        <h2 className="text-sm font-bold text-muted-foreground">منابع سرور و کانتینر</h2>
        <ResourcesPanel
          snapshot={resources?.snapshot ?? null}
          alerts={resources?.alerts ?? []}
          thresholds={resources?.thresholds ?? overview?.thresholds ?? DEFAULT_THRESHOLDS}
          stale={stale}
          onThresholdsSaved={(t) => {
            if (overview) setOverview({ ...overview, thresholds: t })
            if (resources) setResources({ ...resources, thresholds: t })
          }}
        />
      </section>

      {/* ─── بررسی از مرورگر ─── */}
      <section className="space-y-3" aria-label="بررسی از مرورگر مدیر">
        <h2 className="text-sm font-bold text-muted-foreground">بررسی اتصال — از مرورگر شما</h2>
        <BrowserTestsPanel />
      </section>

      {/* ─── خطاهای اخیر ─── */}
      <section className="space-y-3" aria-label="خطاها و هشدارهای اخیر">
        <h2 className="text-sm font-bold text-muted-foreground">خطاها و هشدارهای اخیر</h2>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {events?.policy
                ? `فقط تغییر وضعیت‌ها ثبت می‌شوند — پاک‌سازی خودکار پس از ${faNum(events.policy.retentionDays)} روز یا بیش از ${faNum(events.policy.hardCap)} رکورد.`
                : '—'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {events === null ? (
              <Skeleton className="h-24 w-full" />
            ) : events.events.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                هیچ خطا یا هشداری ثبت نشده است (از آخرین راه‌اندازی سرویس پایش)
              </div>
            ) : (
              <ScrollArea className="max-h-72">
                <ul className="space-y-1.5 text-xs">
                  {events.events.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5"
                    >
                      <Badge
                        variant="outline"
                        className={
                          e.kind === 'error'
                            ? 'text-red-700 dark:text-red-400 border-red-500/40 shrink-0'
                            : e.kind === 'alert'
                              ? 'text-amber-700 dark:text-amber-400 border-amber-500/40 shrink-0'
                              : 'text-emerald-700 dark:text-emerald-400 border-emerald-500/40 shrink-0'
                        }
                      >
                        {e.kind === 'error' ? 'خطا' : e.kind === 'alert' ? 'هشدار' : 'بازیابی'}
                      </Badge>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{serviceLabel(e.service)}</span>
                        <span className="text-muted-foreground"> — {e.message}</span>
                        {e.detail ? (
                          <span className="block text-[11px] text-muted-foreground/80 mt-0.5">{e.detail}</span>
                        ) : null}
                      </span>
                      <time className="text-[10px] text-muted-foreground shrink-0">{fmtDateTime(e.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </section>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        این صفحه فقط برای مشاهده و تشخیص است؛ هیچ دکمهٔ اجرای فرمان، ری‌استارت سرویس، حذف داده یا تغییر زیرساخت ندارد.
        وضعیت‌ها با مهلت پاسخ مشخص بررسی می‌شوند و خرابی یک سرویس مانع نمایش بقیه نمی‌شود.
      </p>
    </div>
  )
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

function ServiceCard({ check, stale, now }: { check: ServiceCheck; stale: boolean; now: number }) {
  const Icon = SERVICE_ICONS[check.key] ?? Globe
  return (
    <Card className="h-full">
      <CardContent className="pt-5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{check.label}</div>
              <div className="text-[11px] text-muted-foreground">
                {check.checkedAt ? `بررسی: ${fmtAgo(check.checkedAt, now)}` : '—'}
                {check.latencyMs !== null ? ` — پاسخ در ${faNum(check.latencyMs)} م‌ث` : ''}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <StatusBadge status={check.status} label={STATUS_LABELS[check.status]} />
            {stale ? (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-500/40 text-[10px]">
                داده قدیمی
              </Badge>
            ) : null}
          </div>
        </div>
        {check.detail ? <p className="text-[11px] text-muted-foreground leading-5">{check.detail}</p> : null}
        {check.error ? (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-700 dark:text-red-400 space-y-1">
            <div className="flex items-start gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>{check.error}</span>
            </div>
            {check.hint ? (
              <div className="flex items-start gap-1.5 text-red-700/80 dark:text-red-400/80">
                <RotateCcw className="h-3.5 w-3.5 shrink-0 mt-px" />
                <span>اقدام پیشنهادی: {check.hint}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

const DEFAULT_THRESHOLDS: InfraThresholds = {
  cpuThreshold: 85,
  ramThreshold: 85,
  diskThreshold: 90,
  sustainedCount: 3,
}

function serviceLabel(key: string): string {
  const map: Record<string, string> = {
    db: 'دیتابیس',
    upload: 'فضای آپلود',
    socket: 'پیام‌رسان',
    livekit: 'سرور رسانه',
    turn: 'TURN',
    cpu: 'پردازنده',
    ram: 'حافظه',
    disk: 'دیسک',
  }
  return map[key] ?? key
}
