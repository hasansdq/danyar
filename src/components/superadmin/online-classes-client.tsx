'use client'

/**
 * صفحهٔ «مدیریت کلاس‌های آنلاین» — مدیر کل.
 *
 * - فهرست مدارس با جست‌وجو/فیلتر/صفحه‌بندی + وضعیت کلاس آنلاین هر مدرسه
 *   (سقف افراد هم‌زمان هر جلسه — معلم نیز جزو ظرفیت — و سقف جلسات هم‌زمان)
 * - آمار کلی با فیلتر مدرسه و بازهٔ زمانی — همهٔ اعداد از دادهٔ واقعی
 * - تازه‌سازی سبک که با پنهان‌شدن صفحه متوقف می‌شود + دکمهٔ تازه‌سازی دستی
 * - تنظیم ظرفیت = محدودیت نرم‌افزاری ورود است؛ تضمین توان سخت‌افزاری نیست
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { faNum } from '@/lib/format'
import {
  RefreshCw,
  Video,
  School as SchoolIcon,
  Users,
  Activity,
  TrendingUp,
  Clock,
  Search,
  ChevronRight,
  ChevronLeftIcon,
  ChevronRightIcon,
  Info,
} from 'lucide-react'
import {
  type SchoolsListData,
  type SchoolLiveRow,
  type StatsData,
  OnlineClassBadge,
  capLabel,
  concurrentLabel,
  fmtDurationMin,
} from './oc-shared'
import { SchoolDetailView } from './oc-school-detail'
import { SessionDetailDialog } from './oc-session-detail'

const POLL_INTERVAL_MS = 30_000

type RangeKey = 'today' | '7d' | '30d' | 'all'

const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'امروز',
  '7d': '۷ روز گذشته',
  '30d': '۳۰ روز گذشته',
  all: 'همهٔ بازه‌ها',
}

export function OnlineClassesClient() {
  const [list, setList] = useState<SchoolsListData | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsData | null>(null)
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [enabled, setEnabled] = useState<'all' | 'yes' | 'no'>('all')
  const [page, setPage] = useState(1)
  const [range, setRange] = useState<RangeKey>('30d')
  const [selectedSchoolId, setSelectedSchoolId] = useState<string | null>(null)
  const [sessionDialogId, setSessionDialogId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const visibleRef = useRef(true)
  const [lastDataAt, setLastDataAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  const fetchAll = useCallback(
    async (silent: boolean) => {
      if (!silent) setRefreshing(true)
      try {
        const params = new URLSearchParams({
          q,
          enabled,
          page: String(page),
          pageSize: '10',
        })
        const [listRes, statsRes] = await Promise.allSettled([
          fetch(`/api/superadmin/online-classes/schools?${params}`, { cache: 'no-store' }).then(
            async (r) => {
              if (!r.ok)
                throw new Error(((await r.json().catch(() => null))?.error) ?? `کد ${r.status}`)
              return (await r.json()) as SchoolsListData
            },
          ),
          fetch(`/api/superadmin/online-classes/stats?range=${range}`, { cache: 'no-store' }).then(
            async (r) => {
              if (!r.ok)
                throw new Error(((await r.json().catch(() => null))?.error) ?? `کد ${r.status}`)
              return (await r.json()) as StatsData
            },
          ),
        ])
        if (listRes.status === 'fulfilled') {
          setList(listRes.value)
          setListError(null)
          setLastDataAt(Date.now())
        } else {
          setListError(
            listRes.reason instanceof Error ? listRes.reason.message : 'دریافت فهرست مدارس ناموفق بود',
          )
        }
        if (statsRes.status === 'fulfilled') {
          setStats(statsRes.value)
        }
      } finally {
        if (!silent) setRefreshing(false)
      }
    },
    [q, enabled, page, range],
  )

  // بارگذاری اولیه + تازه‌سازی خودکار سبک (متوقف هنگام پنهان‌بودن صفحه)
  useEffect(() => {
    void fetchAll(false)
  }, [fetchAll])

  useEffect(() => {
    const onVis = () => {
      visibleRef.current = document.visibilityState === 'visible'
      if (visibleRef.current) void fetchAll(true)
    }
    document.addEventListener('visibilitychange', onVis)
    const timer = setInterval(() => {
      if (visibleRef.current) void fetchAll(true)
    }, POLL_INTERVAL_MS)
    const clock = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(timer)
      clearInterval(clock)
    }
  }, [fetchAll])

  const dataAgeSec = lastDataAt ? Math.max(0, Math.round((now - lastDataAt) / 1000)) : null

  const applySearch = () => {
    setQ(qInput.trim())
    setPage(1)
  }

  // ─── نمای جزئیات مدرسه ───
  if (selectedSchoolId) {
    return (
      <>
        <SchoolDetailView
          schoolId={selectedSchoolId}
          onBack={() => {
            setSelectedSchoolId(null)
            void fetchAll(true)
          }}
          onOpenSession={(sessionId) => setSessionDialogId(sessionId)}
        />
        {/* دیالوگ جزئیات جلسه — در هر دو نما (فهرست/جزئیات) در دسترس است */}
        <SessionDetailDialog
          sessionId={sessionDialogId}
          onClose={() => setSessionDialogId(null)}
          onEnded={() => void fetchAll(true)}
        />
      </>
    )
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* سربرگ */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <Video className="h-6 w-6 text-primary" />
            مدیریت کلاس‌های آنلاین
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
            سقف‌ها و فعال‌بودن کلاس آنلاین هر مدرسه، جلسات جاری و تاریخچه، آمار عملکرد و
            کنترل جلسات — همهٔ محدودیت‌ها در API، سوکت و مسیر ورود LiveKit اعمال می‌شوند.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dataAgeSec !== null && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              آخرین داده: {faNum(dataAgeSec)} ثانیه پیش
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchAll(false)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            تازه‌سازی
          </Button>
        </div>
      </div>

      {/* آمار کلی */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-primary" />
              آمار و عملکرد
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={range}
                onValueChange={(v) => setRange(v as RangeKey)}
              >
                <SelectTrigger className="h-8 w-36 text-xs" aria-label="بازهٔ زمانی آمار">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {RANGE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>
            فیلتر بر اساس بازهٔ زمانی — با انتخاب هر مدرسه، آمار همان مدرسه در صفحهٔ
            جزئیات با همین تعریف شاخص‌ها نمایش داده می‌شود.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!stats ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
                <StatTile
                  icon={<Video className="h-4 w-4" />}
                  label="جلسات فعال"
                  value={faNum(stats.activeSessions)}
                  source={stats.sources.activeSessions}
                />
                <StatTile
                  icon={<SchoolIcon className="h-4 w-4" />}
                  label="جلسات برگزارشده"
                  value={faNum(stats.heldSessions)}
                  source={stats.sources.heldSessions}
                />
                <StatTile
                  icon={<Users className="h-4 w-4" />}
                  label="افراد حاضر"
                  value={faNum(stats.presentUsers)}
                  source={stats.sources.presentUsers}
                />
                <StatTile
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="بیشترین حضور هم‌زمان"
                  value={
                    stats.peakAttendance
                      ? `${faNum(stats.peakAttendance.value)}${stats.peakAttendance.approximate ? ' (تقریبی)' : ''}`
                      : 'در دسترس نیست'
                  }
                  source={stats.sources.peakAttendance}
                />
                <StatTile
                  icon={<Clock className="h-4 w-4" />}
                  label="میانگین مدت جلسه"
                  value={fmtDurationMin(stats.avgDurationMin)}
                  source={stats.sources.duration}
                />
                <StatTile
                  icon={<RefreshCw className="h-4 w-4" />}
                  label="قطع‌ووصل ثبت‌شده"
                  value={faNum(stats.reconnects)}
                  source={stats.sources.reconnects}
                />
              </div>
              <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground bg-muted/60 rounded-lg p-2.5 leading-relaxed">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  کیفیت اتصال، نرخ بیت، packet loss و تأخیر در مرورگر هر شرکت‌کننده
                  اندازه‌گیری می‌شوند و منبع سرور-جانبی ندارند — در جزئیات هر جلسهٔ
                  فعال، وضعیت اتصال LiveKit قابل مشاهده است. مصرف CPU/RAM سرور مشترک
                  است و به مدرسه‌ای نسبت داده نمی‌شود (بخش «وضعیت زیرساخت»).
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* فهرست مدارس */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SchoolIcon className="h-4.5 w-4.5 text-primary" />
            مدارس
          </CardTitle>
          <CardDescription>
            برای هر مدرسه: وضعیت کلاس آنلاین، سقف افراد هم‌زمان هر جلسه (معلم نیز جزو
            ظرفیت)، سقف جلسات هم‌زمان، جلسات فعال و مجموع افراد آنلاین.
          </CardDescription>
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="جست‌وجوی نام مدرسه…"
                className="pr-8 h-9 text-sm"
                aria-label="جست‌وجوی نام مدرسه"
              />
            </div>
            <Button size="sm" variant="secondary" className="h-9" onClick={applySearch}>
              جست‌وجو
            </Button>
            <Select
              value={enabled}
              onValueChange={(v) => {
                setEnabled(v as 'all' | 'yes' | 'no')
                setPage(1)
              }}
            >
              <SelectTrigger className="h-9 w-40 text-sm" aria-label="فیلتر وضعیت کلاس آنلاین">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-sm">همهٔ مدارس</SelectItem>
                <SelectItem value="yes" className="text-sm">کلاس آنلاین فعال</SelectItem>
                <SelectItem value="no" className="text-sm">کلاس آنلاین غیرفعال</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {listError && (
            <p className="text-sm text-destructive mb-3">{listError}</p>
          )}
          {!list ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : list.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              مدرسه‌ای با این مشخصات یافت نشد.
            </p>
          ) : (
            <div className="space-y-2">
              {list.rows.map((s) => (
                <SchoolRow
                  key={s.id}
                  school={s}
                  onOpen={() => {
                    setSelectedSchoolId(s.id)
                  }}
                />
              ))}
              {/* صفحه‌بندی */}
              <div className="flex items-center justify-between gap-3 pt-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {faNum(list.total)} مدرسه — صفحهٔ {faNum(list.page)} از {faNum(totalPages)}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronRightIcon className="h-3.5 w-3.5" />
                    قبلی
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    بعدی
                    <ChevronLeftIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ جزئیات جلسه */}
      <SessionDetailDialog
        sessionId={sessionDialogId}
        onClose={() => setSessionDialogId(null)}
        onEnded={() => void fetchAll(true)}
      />
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  source,
}: {
  icon: React.ReactNode
  label: string
  value: string
  source?: string
}) {
  return (
    <div
      className="rounded-xl border bg-card p-3 space-y-1"
      title={source ?? undefined}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      {source && (
        <div className="text-[10px] text-muted-foreground/80 line-clamp-1" title={source}>
          {source}
        </div>
      )}
    </div>
  )
}

function SchoolRow({ school, onOpen }: { school: SchoolLiveRow; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-full text-right rounded-xl border bg-card hover:bg-accent/60 transition-colors p-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-sm truncate">{school.name}</span>
          <OnlineClassBadge enabled={school.onlineClass} />
          {!school.isActive && (
            <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-600 dark:text-red-400">
              مدرسه غیرفعال
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {faNum(school.classroomsCount)} کلاس
        </span>
      </div>
      <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap mt-2.5 pr-6 text-xs">
        <span className="text-muted-foreground">
          سقف هر جلسه:{' '}
          <span className="font-medium text-foreground">
            {capLabel(school.liveMaxParticipants, `پیش‌فرض ${faNum(school.effectiveSessionCap)} نفر`)}
          </span>
        </span>
        <span className="text-muted-foreground">
          سقف هم‌زمان:{' '}
          <span className="font-medium text-foreground">
            {concurrentLabel(school.liveMaxConcurrent)}
          </span>
        </span>
        <span className="text-muted-foreground">
          جلسات فعال:{' '}
          <span
            className={`font-bold tabular-nums ${
              school.activeSessions > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
            }`}
          >
            {faNum(school.activeSessions)}
          </span>
        </span>
        <span className="text-muted-foreground">
          افراد آنلاین:{' '}
          <span
            className={`font-bold tabular-nums ${
              school.onlineUsers > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
            }`}
          >
            {faNum(school.onlineUsers)}
          </span>
        </span>
      </div>
    </button>
  )
}
