import { db } from '@/lib/db'
import {
  LIVE_MAX_PARTICIPANTS,
  effectiveCapacity,
  effectiveMaxConcurrent,
} from '@/lib/live-access'

/**
 * موتور «مدیریت کلاس‌های آنلاین» — کمکی‌های مشترک APIهای پنل مدیر کل.
 *
 * اصول:
 * - همهٔ داده‌ها از منابع واقعی می‌آیند؛ چیزی که در دسترس نیست «در دسترس نیست»
 *   برمی‌گردد، هرگز صفر/مقدار ساختگی نمایش داده نمی‌شود.
 * - مصرف CPU/RAM سرور به مدرسه‌ای نسبت داده نمی‌شود (آن‌ها در بخش «وضعیت زیرساخت» می‌مانند).
 * - آمار با کوئری‌های on-demand و سقف ردیف محاسبه می‌شود — بدون جدول تجمیعی
 *   جدید و بدون رشد نامحدود دیتابیس.
 */

const SOCKET_INTERNAL_URL =
  (process.env.SOCKET_INTERNAL_URL?.trim() || 'http://127.0.0.1:3003').replace(/\/$/, '')
const SOCKET_INTERNAL_SECRET = process.env.SOCKET_INTERNAL_SECRET?.trim() ?? ''

/** سقف ردیف گزارش‌های حضور برای محاسبهٔ اوج هم‌زمانی — بالاتر از این = تقریبی */
const PEAK_MAX_ROWS = 20_000

// ─── انواع پاسخ ───

export interface SocketLiveStats {
  ok: boolean
  maxParticipants: number
  hostConnected: boolean
  participants: {
    userId: string
    name: string
    role: string
    micOn: boolean
    camOn: boolean
    sharing: boolean
    handRaised: boolean
    canSpeak: boolean
    canShare: boolean
    canCam: boolean
    mutedByTeacher: boolean
  }[]
}

/** وضعیت لحظه‌ای جلسه از حافظهٔ سرویس سوکت — null یعنی در حافظه فعال نیست */
export async function fetchSocketLiveStats(
  sessionId: string,
): Promise<SocketLiveStats | null> {
  try {
    const r = await fetch(`${SOCKET_INTERNAL_URL}/internal/live-stats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': SOCKET_INTERNAL_SECRET,
      },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(4000),
    })
    if (!r.ok) return null
    return (await r.json()) as SocketLiveStats
  } catch {
    return null
  }
}

/** پایان جلسه از طریق سرویس سوکت (اتصال همه قطع + حذف اتاق LiveKit + همگام‌سازی DB) */
export async function socketLiveEnd(
  sessionId: string,
  enderId: string,
  reason?: string,
): Promise<boolean> {
  try {
    const r = await fetch(`${SOCKET_INTERNAL_URL}/internal/live-end`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': SOCKET_INTERNAL_SECRET,
      },
      body: JSON.stringify({ sessionId, enderId, reason }),
      signal: AbortSignal.timeout(6000),
    })
    return r.ok
  } catch {
    return false
  }
}

// ─── آمار (on-demand، بدون جدول جدید) ───

export interface PeriodFilter {
  schoolId?: string | null
  from?: Date | null
  to?: Date | null
}

function sessionWhere(f: PeriodFilter) {
  const where: {
    classroom?: { schoolId?: string }
    startedAt?: { gte?: Date; lte?: Date }
  } = {}
  if (f.schoolId) where.classroom = { schoolId: f.schoolId }
  if (f.from || f.to) {
    where.startedAt = {}
    if (f.from) where.startedAt.gte = f.from
    if (f.to) where.startedAt.lte = f.to
  }
  return where
}

/**
 * اوج حضور هم‌زمان — جاروب رویداد (+۱ ورود / −۱ خروج) روی گزارش‌های حضور.
 * اگر گزارش‌ها از سقف ردیف بیشتر باشند، «approximate: true» برمی‌گردد
 * (صادقانه؛ عدد ساختگی/ناقص بدون برچسب نمایش داده نمی‌شود).
 */
export function peakConcurrencyFromLogs(
  logs: { joinedAt: Date; leftAt: Date | null; sessionEndedAt: Date | null }[],
): { peak: number; approximate: boolean } {
  type Ev = { t: number; d: 1 | -1 }
  const events: Ev[] = []
  for (const l of logs) {
    events.push({ t: l.joinedAt.getTime(), d: 1 })
    const end = l.leftAt ?? l.sessionEndedAt
    events.push({ t: (end ?? new Date()).getTime() + 1, d: -1 })
  }
  events.sort((a, b) => a.t - b.t || a.d - b.d)
  let cur = 0
  let peak = 0
  for (const e of events) {
    cur += e.d
    if (cur > peak) peak = cur
  }
  return { peak, approximate: false }
}

export interface OnlineClassesStats {
  generatedAt: string
  period: { from: string | null; to: string | null; schoolId: string | null }
  /** جلسات ACTIVE همین لحظه (فقط وقتی فیلتر همهٔ مدارس/بدون بازه است لحظه‌ای است) */
  activeSessions: number
  heldSessions: number
  /** افراد حاضر لحظه‌ای جلسات فعال — از شمارش گزارش‌های leftAt=null جلسات ACTIVE */
  presentUsers: number
  peakAttendance: { value: number; approximate: boolean } | null
  /** مدت کل جلسات برگزارشده (دقیقه) و میانگین (دقیقه) */
  totalDurationMin: number | null
  avgDurationMin: number | null
  /** تعداد اتصال‌های مجدد ثبت‌شده (قطع‌ووصل واقعی) */
  reconnects: number
  metricsNotAvailable: string[]
  sources: Record<string, string>
}

/** آمار جلسات بر اساس مدرسه و بازهٔ زمانی — همهٔ اعداد از دادهٔ واقعی */
export async function computeOnlineClassesStats(
  f: PeriodFilter,
): Promise<OnlineClassesStats> {
  const where = sessionWhere(f)
  const [activeCount, endedCount, endedSessions, activeIds, logAgg] = await Promise.all([
    db.liveSession.count({
      where: { ...where, status: 'ACTIVE' },
    }),
    db.liveSession.count({
      where: { ...where, status: 'ENDED' },
    }),
    db.liveSession.findMany({
      where: { ...where, status: 'ENDED' },
      select: { startedAt: true, endedAt: true },
      take: 10_000,
    }),
    db.liveSession.findMany({
      where: { ...where, status: 'ACTIVE' },
      select: { id: true },
    }),
    db.liveParticipantLog.aggregate({
      where: {
        session: {
          ...(where.classroom ? { classroom: where.classroom } : {}),
          ...(where.startedAt ? { startedAt: where.startedAt } : {}),
        },
      },
      _sum: { reconnects: true },
    }),
  ])

  const activeIdList = activeIds.map((s) => s.id)
  const presentUsers = activeIdList.length
    ? await db.liveParticipantLog.count({
        where: { sessionId: { in: activeIdList }, leftAt: null },
      })
    : 0

  // اوج هم‌زمانی — گزارش‌های حضور جلسات همان فیلتر
  const logs = await db.liveParticipantLog.findMany({
    where: {
      session: {
        ...(where.classroom ? { classroom: where.classroom } : {}),
        ...(where.startedAt ? { startedAt: where.startedAt } : {}),
      },
    },
    select: { joinedAt: true, leftAt: true, session: { select: { endedAt: true } } },
    take: PEAK_MAX_ROWS + 1,
  })
  const approximate = logs.length > PEAK_MAX_ROWS
  const peakLogs = logs.slice(0, PEAK_MAX_ROWS).map((log) => ({
    joinedAt: log.joinedAt,
    leftAt: log.leftAt,
    sessionEndedAt: log.session.endedAt,
  }))
  const peak = peakConcurrencyFromLogs(peakLogs)

  const durationsMin = endedSessions
    .filter((s) => s.endedAt)
    .map((s) => (s.endedAt!.getTime() - s.startedAt.getTime()) / 60_000)
    .filter((d) => d >= 0)
  const totalDurationMin =
    durationsMin.length > 0
      ? Math.round(durationsMin.reduce((a, b) => a + b, 0) * 10) / 10
      : null
  const avgDurationMin =
    durationsMin.length > 0
      ? Math.round((durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length) * 10) / 10
      : null

  const notAvailable: string[] = []
  if (peak.peak === 0 && logs.length === 0) notAvailable.push('peakAttendance')
  if (totalDurationMin === null) notAvailable.push('duration')

  return {
    generatedAt: new Date().toISOString(),
    period: {
      from: f.from?.toISOString() ?? null,
      to: f.to?.toISOString() ?? null,
      schoolId: f.schoolId ?? null,
    },
    activeSessions: activeCount,
    heldSessions: endedCount,
    presentUsers,
    peakAttendance: notAvailable.includes('peakAttendance')
      ? null
      : { value: peak.peak, approximate },
    totalDurationMin,
    avgDurationMin,
    reconnects: logAgg._sum.reconnects ?? 0,
    metricsNotAvailable: notAvailable,
    sources: {
      activeSessions: 'دیتابیس — جدول جلسات (وضعیت ACTIVE)',
      heldSessions: 'دیتابیس — جدول جلسات (وضعیت ENDED)',
      presentUsers: 'دیتابیس — گزارش حضور جلسات فعال (leftAt خالی)',
      peakAttendance: `دیتابیس — جاروب رویداد ورود/خروج گزارش‌های حضور${approximate ? ' (تقریبی — دادهٔ بیش از سقف محاسبه)' : ''}`,
      duration: 'دیتابیس — زمان شروع تا پایان جلسات برگزارشده',
      reconnects: 'دیتابیس — شمارندهٔ اتصال مجدد گزارش حضور',
    },
  }
}

// ─── ردیف مدارس (فهرست پنل) ───

export interface SchoolLiveRow {
  id: string
  name: string
  isActive: boolean
  onlineClass: boolean
  liveMaxParticipants: number | null
  liveMaxConcurrent: number | null
  activeSessions: number
  onlineUsers: number
  classroomsCount: number
  /** سقف مؤثر جلسه (حداقلِ جهانی/مدرسه) — نمایش «تا N نفر» */
  effectiveSessionCap: number
  effectiveMaxConcurrent: number
}

/** اطلاعات زندهٔ کلاس آنلاین مدارس (فهرست با جست‌وجو/صفحه‌بندی/فیلتر) */
export async function schoolsLiveRows(opts: {
  q?: string
  enabled?: 'yes' | 'no' | 'all'
  page: number
  pageSize: number
}): Promise<{ rows: SchoolLiveRow[]; total: number; page: number; pageSize: number }> {
  const whereSchools: {
    name?: { contains: string }
    isActive?: boolean
  } = {}
  if (opts.q && opts.q.trim()) whereSchools.name = { contains: opts.q.trim() }

  // فیلتر فعال/غیرفعال نیاز به بررسی JSON است — در JS پس از واکشی idها اعمال می‌شود
  const [totalAll, schools] = await Promise.all([
    db.school.count({ where: whereSchools }),
    db.school.findMany({
      where: whereSchools,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        isActive: true,
        features: true,
        liveMaxParticipants: true,
        liveMaxConcurrent: true,
        classrooms: { select: { id: true } },
      },
    }),
  ])

  const parsed = schools.map((s) => {
    let onlineClass = false
    try {
      onlineClass = (JSON.parse(s.features) as { onlineClass?: boolean })?.onlineClass === true
    } catch {
      onlineClass = false
    }
    return { s, onlineClass }
  })

  const filtered =
    !opts.enabled || opts.enabled === 'all'
      ? parsed
      : parsed.filter((p) => (opts.enabled === 'yes' ? p.onlineClass : !p.onlineClass))

  const total = filtered.length
  const start = (opts.page - 1) * opts.pageSize
  const pageRows = filtered.slice(start, start + opts.pageSize)
  const ids = pageRows.map((p) => p.s.id)

  const activeSessions = ids.length
    ? await db.liveSession.findMany({
        where: { classroom: { schoolId: { in: ids } }, status: 'ACTIVE' },
        select: { id: true, classroom: { select: { schoolId: true } } },
      })
    : []
  const sessionIds = activeSessions.map((s) => s.id)
  const onlineCounts = sessionIds.length
    ? await db.liveParticipantLog.groupBy({
        by: ['sessionId'],
        where: { sessionId: { in: sessionIds }, leftAt: null },
        _count: { sessionId: true },
      })
    : []
  const onlineBySession = new Map(onlineCounts.map((c) => [c.sessionId, c._count.sessionId]))

  const activeBySchool = new Map<string, number>()
  const onlineBySchool = new Map<string, number>()
  for (const s of activeSessions) {
    const sid = s.classroom.schoolId
    activeBySchool.set(sid, (activeBySchool.get(sid) ?? 0) + 1)
    onlineBySchool.set(sid, (onlineBySchool.get(sid) ?? 0) + (onlineBySession.get(s.id) ?? 0))
  }

  const rows: SchoolLiveRow[] = pageRows.map(({ s, onlineClass }) => ({
    id: s.id,
    name: s.name,
    isActive: s.isActive,
    onlineClass,
    liveMaxParticipants: s.liveMaxParticipants,
    liveMaxConcurrent: s.liveMaxConcurrent,
    activeSessions: activeBySchool.get(s.id) ?? 0,
    onlineUsers: onlineBySchool.get(s.id) ?? 0,
    classroomsCount: s.classrooms.length,
    effectiveSessionCap: effectiveCapacity(null, s.liveMaxParticipants),
    effectiveMaxConcurrent: effectiveMaxConcurrent(s.liveMaxConcurrent),
  }))

  return { rows, total, page: opts.page, pageSize: opts.pageSize }
}

export { LIVE_MAX_PARTICIPANTS, effectiveCapacity, effectiveMaxConcurrent }
