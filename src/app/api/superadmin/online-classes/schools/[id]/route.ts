import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { guardSuperAdminApi, infraJson } from '@/lib/infra/route-helpers'
import { parseFeatures } from '@/lib/features'
import {
  LIVE_MAX_PARTICIPANTS,
  effectiveCapacity,
  effectiveMaxConcurrent,
  validSchoolLiveMaxParticipants,
  validSchoolLiveMaxConcurrent,
} from '@/lib/live-access'
import { fetchSocketLiveStats, computeOnlineClassesStats } from '@/lib/online-classes'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/superadmin/online-classes/schools/[id] — صفحهٔ جزئیات مدرسه:
 * تنظیمات اختصاصی + کلاس‌ها (با ظرفیت مؤثر) + جلسات فعال (وضعیت لحظه‌ای سوکت)
 * + تاریخچهٔ جلسات (صفحه‌بندی) — فقط مدیر کل.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await guardSuperAdminApi('oc-school-detail', 60, 60_000)
  if ('response' in guard) return guard.response
  const { id } = await params

  const school = await db.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      isActive: true,
      features: true,
      liveMaxParticipants: true,
      liveMaxConcurrent: true,
    },
  })
  if (!school) return infraJson({ error: 'مدرسه یافت نشد' }, 404)

  const sp = req.nextUrl.searchParams
  const historyPage = Math.max(1, parseInt(sp.get('historyPage') ?? '1') || 1)
  const historyPageSize = Math.min(50, Math.max(5, parseInt(sp.get('historyPageSize') ?? '10') || 10))
  const historyWhere = { classroom: { schoolId: id }, status: 'ENDED' as const }

  const [classrooms, activeSessions, historyTotal, history, stats] = await Promise.all([
    db.classroom.findMany({
      where: { schoolId: id },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        capacity: true,
        _count: { select: { enrollments: true, subjectGroups: true } },
      },
    }),
    db.liveSession.findMany({
      where: { classroom: { schoolId: id }, status: 'ACTIVE' },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        title: true,
        startedAt: true,
        announcedAt: true,
        classroom: { select: { id: true, name: true, capacity: true } },
        host: { select: { id: true, fullName: true } },
        _count: { select: { participantLogs: { where: { leftAt: null } } } },
      },
    }),
    db.liveSession.count({ where: historyWhere }),
    db.liveSession.findMany({
      where: historyWhere,
      orderBy: { endedAt: 'desc' },
      skip: (historyPage - 1) * historyPageSize,
      take: historyPageSize,
      select: {
        id: true,
        title: true,
        startedAt: true,
        endedAt: true,
        forceEndReason: true,
        classroom: { select: { name: true } },
        host: { select: { fullName: true } },
        ender: { select: { fullName: true, role: true } },
        _count: {
          select: {
            participantLogs: true,
            chatMessages: true,
          },
        },
      },
    }),
    computeOnlineClassesStats({ schoolId: id }),
  ])

  // وضعیت لحظه‌ای جلسات فعال از حافظهٔ سرویس سوکت (افراد حاضر واقعی)
  const liveStates = await Promise.all(
    activeSessions.map(async (s) => ({
      sessionId: s.id,
      stats: await fetchSocketLiveStats(s.id),
    })),
  )
  const statsBySession = new Map(liveStates.map((x) => [x.sessionId, x.stats]))

  return infraJson({
    school: {
      id: school.id,
      name: school.name,
      isActive: school.isActive,
      onlineClass: parseFeatures(school.features).onlineClass,
      liveMaxParticipants: school.liveMaxParticipants,
      liveMaxConcurrent: school.liveMaxConcurrent,
    },
    limits: {
      globalMaxParticipants: LIVE_MAX_PARTICIPANTS,
      effectiveSessionCap: effectiveCapacity(null, school.liveMaxParticipants),
      effectiveMaxConcurrent: effectiveMaxConcurrent(school.liveMaxConcurrent),
    },
    note: 'سقف‌ها محدودیت نرم‌افزاری ورود هستند و تضمین توان سخت‌افزاری برای آن تعداد کاربر نیستند؛ معلم نیز جزو ظرفیت جلسه محسوب می‌شود',
    classrooms: classrooms.map((c) => ({
      id: c.id,
      name: c.name,
      capacity: c.capacity,
      effectiveCapacity: effectiveCapacity(c.capacity, school.liveMaxParticipants),
      students: c._count.enrollments,
      groups: c._count.subjectGroups,
    })),
    activeSessions: activeSessions.map((s) => {
      const st = statsBySession.get(s.id)
      return {
        id: s.id,
        title: s.title,
        classroom: { id: s.classroom.id, name: s.classroom.name },
        host: { id: s.host.id, name: s.host.fullName },
        startedAt: s.startedAt.toISOString(),
        announcedAt: s.announcedAt?.toISOString() ?? null,
        // شمارش افراد: اولویت با حافظهٔ زندهٔ سوکت؛ در دسترس نبودن = گزارش دیتابیس
        onlineCount: st ? st.participants.length : s._count.participantLogs,
        onlineCountSource: st ? 'سرویس سوکت (حافظهٔ جلسه)' : 'دیتابیس — گزارش حضور',
        maxParticipants: st ? st.maxParticipants : effectiveCapacity(s.classroom.capacity, school.liveMaxParticipants),
        hostConnected: st ? st.hostConnected : null,
      }
    }),
    history: {
      total: historyTotal,
      page: historyPage,
      pageSize: historyPageSize,
      sessions: history.map((s) => ({
        id: s.id,
        title: s.title,
        classroomName: s.classroom.name,
        hostName: s.host.fullName,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        durationMin:
          s.endedAt
            ? Math.round(((s.endedAt.getTime() - s.startedAt.getTime()) / 60_000) * 10) / 10
            : null,
        participants: s._count.participantLogs,
        chatMessages: s._count.chatMessages,
        forceEnded: !!s.forceEndReason,
        forceEndReason: s.forceEndReason,
        enderName: s.ender?.fullName ?? null,
        enderRole: s.ender?.role ?? null,
      })),
    },
    stats,
  })
}

/**
 * PATCH /api/superadmin/online-classes/schools/[id] — تنظیمات اختصاصی کلاس آنلاین
 * مدرسه (فقط مدیر کل): فعال/غیرفعال، سقف افراد هم‌زمان هر جلسه، سقف جلسات هم‌زمان.
 * ذخیره در دیتابیس — پس از ری‌استارت باقی می‌ماند.
 *
 * بدنه: { onlineClass?, liveMaxParticipants?, liveMaxConcurrent? }
 * مقدار null برای سقف‌ها = حذف سقف اختصاصی (بازگشت به سقف جهانی/نامحدود).
 *
 * سیاست: غیرفعال‌کردن جلسات جاری را قطع نمی‌کند — فقط ایجاد جلسهٔ جدید و ورود
 * جدید مسدود می‌شود (اعمال در API/سوکت/توکن). کاهش سقف افراد، حاضران را اخراج
 * نمی‌کند؛ تا کاهش تعداد، ورود جدید مسدود می‌ماند.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await guardSuperAdminApi('oc-school-patch', 30, 60_000)
  if ('response' in guard) return guard.response
  const { id } = await params

  const school = await db.school.findUnique({
    where: { id },
    select: { id: true, features: true, liveMaxParticipants: true, liveMaxConcurrent: true },
  })
  if (!school) return infraJson({ error: 'مدرسه یافت نشد' }, 404)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return infraJson({ error: 'درخواست نامعتبر است' }, 400)

  const data: {
    features?: string
    liveMaxParticipants?: number | null
    liveMaxConcurrent?: number | null
  } = {}

  if ('onlineClass' in body && typeof body.onlineClass === 'boolean') {
    const current = parseFeatures(school.features)
    data.features = JSON.stringify({ ...current, onlineClass: body.onlineClass })
  }

  if ('liveMaxParticipants' in body) {
    const v = body.liveMaxParticipants
    if (v === null || v === '' || v === 0) {
      data.liveMaxParticipants = null
    } else {
      const n = Number(v)
      if (!Number.isFinite(n) || !validSchoolLiveMaxParticipants(n)) {
        return infraJson(
          { error: 'سقف افراد هم‌زمان هر جلسه باید عددی صحیح بین ۲ تا ۵۰۰ باشد (خالی = سقف سراسری)' },
          400,
        )
      }
      data.liveMaxParticipants = n
    }
  }

  if ('liveMaxConcurrent' in body) {
    const v = body.liveMaxConcurrent
    if (v === null || v === '' || v === 0) {
      data.liveMaxConcurrent = null
    } else {
      const n = Number(v)
      if (!Number.isFinite(n) || !validSchoolLiveMaxConcurrent(n)) {
        return infraJson(
          { error: 'سقف جلسات هم‌زمان باید عددی صحیح بین ۱ تا ۱۰۰ باشد (خالی = نامحدود)' },
          400,
        )
      }
      data.liveMaxConcurrent = n
    }
  }

  if (Object.keys(data).length === 0) {
    return infraJson({ error: 'تغییری ارسال نشده است' }, 400)
  }

  // کاهش سقف جلسهٔ مدرسه: ظرفیت اختصاصی کلاس‌های بالاتر «خودکار به سقف جدید
  // محدود نمی‌شوند» — ظرفیت مؤثر در لحظهٔ ورود با min اعمال می‌شود؛ اما برای
  // شفافیت، تعداد کلاس‌های فراتر از سقف جدید برگردانده می‌شود تا مدیر بداند.
  let classroomsAboveCap = 0
  if (data.liveMaxParticipants !== undefined && data.liveMaxParticipants !== null) {
    classroomsAboveCap = await db.classroom.count({
      where: { schoolId: id, capacity: { gt: data.liveMaxParticipants } },
    })
  }

  await db.school.update({ where: { id }, data })

  const updated = await db.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      features: true,
      liveMaxParticipants: true,
      liveMaxConcurrent: true,
    },
  })

  return infraJson({
    ok: true,
    school: {
      id: updated!.id,
      name: updated!.name,
      onlineClass: parseFeatures(updated!.features).onlineClass,
      liveMaxParticipants: updated!.liveMaxParticipants,
      liveMaxConcurrent: updated!.liveMaxConcurrent,
    },
    classroomsAboveCap,
    classroomsAboveCapNote:
      classroomsAboveCap > 0
        ? 'ظرفیت اختصاصی این تعداد کلاس از سقف جدید بیشتر است؛ ظرفیت مؤثرشان همان سقف مدرسه خواهد بود (بدون اخراج حاضران — فقط ورود جدید محدود می‌شود)'
        : null,
  })
}
