import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { notifySocket, roomForUser } from '@/lib/notify'
import {
  LIVE_MAX_PARTICIPANTS,
  LIVE_MAX_CONCURRENT_SESSIONS,
  onlineClassEnabled,
  teacherClassrooms,
  effectiveCapacity,
  effectiveMaxConcurrent,
} from '@/lib/live-access'
import { ONLINE_CLASS_DISABLED_MSG } from '@/lib/features'

/**
 * مهلت رهاشدگی جلسه اعلام‌نشده (ثانیه) — جلسه‌ای که معلم ساخت ولی هرگز وارد آن
 * نشد (سوکت قطع، تب بسته، مجوز رسانه داده نشد) نباید برای همیشه در وضعیت
 * «در حال آماده‌سازی» برای دانش‌آموزان بماند؛ پس از این مهلت به‌طور خودکار پایان می‌یابد.
 */
const UNANNOUNCED_TTL_SECONDS = Math.max(
  60,
  Number(process.env.LIVE_UNANNOUNCED_TTL_SECONDS ?? 300),
)

/**
 * پاک‌سازی خودکار جلسات ACTIVE بدون اعلام شروع که از مهلت گذشته‌اند —
 * چون تا اعلام شروع هیچ‌کس وارد اتاق نمی‌شود، این جلسات در سرور سوکت حالت
 * درون‌حافظه‌ای ندارند و پایان دیتابیسی + همگام‌سازی UI کافی است.
 */
async function sweepUnannouncedSessions(schoolId: string) {
  const cutoff = new Date(Date.now() - UNANNOUNCED_TTL_SECONDS * 1000)
  const stale = await db.liveSession.findMany({
    where: {
      status: 'ACTIVE',
      announcedAt: null,
      startedAt: { lt: cutoff },
      classroom: { schoolId },
    },
    select: { id: true, classroomId: true },
  })
  for (const s of stale) {
    const now = new Date()
    const upd = await db.liveSession.updateMany({
      where: { id: s.id, status: 'ACTIVE', announcedAt: null },
      data: { status: 'ENDED', endedAt: now, enderId: null },
    })
    if (upd.count === 0) continue
    await db.liveParticipantLog
      .updateMany({ where: { sessionId: s.id, leftAt: null }, data: { leftAt: now } })
      .catch(() => null)
    // همگام‌سازی UI: سوییچ «شروع کلاس» معلم خاموش و فهرست دانش‌آموزان تازه می‌شود
    const [students, teachers] = await Promise.all([
      db.classroomEnrollment.findMany({
        where: { classroomId: s.classroomId, student: { isActive: true } },
        select: { studentId: true },
      }),
      db.teachingAssignment.findMany({
        where: { subjectGroup: { classroomId: s.classroomId } },
        select: { teacherId: true },
      }),
    ])
    const audience = [
      ...new Set([...students.map((x) => x.studentId), ...teachers.map((t) => t.teacherId)]),
    ]
    await notifySocket({
      rooms: audience.map((u) => roomForUser(u)),
      event: 'live:session-status',
      data: { sessionId: s.id, status: 'ENDED' },
    })
    console.log(`[live] unannounced session ${s.id} auto-ended after ${UNANNOUNCED_TTL_SECONDS}s`)
  }
}

/**
 * GET /api/live-sessions — فهرست نقش‌محور کلاس آنلاین:
 * - معلم: کلاس‌های مجاز خودش (+ گروه‌های هر کلاس برای اطلاع‌رسانی) + جلسه فعال هر کلاس
 * - دانش‌آموز: کلاس‌های خودش + جلسه فعال هر کلاس
 * - مدیر مدرسه: جلسات فعال مدرسه خودش
 * announcedAt: اعلام رسمی شروع فقط پس از آماده‌شدن استریم معلم ثبت می‌شود
 */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await onlineClassEnabled(session.schoolId)
  if (!enabled) return jsonError(ONLINE_CLASS_DISABLED_MSG, 403)

  // جلسات رهاشده اعلام‌نشده همین مدرسه — پیش از ساختن فهرست وضعیت واقعی تضمین شود
  await sweepUnannouncedSessions(session.schoolId).catch(() => {})

  if (session.role === 'TEACHER') {
    const classrooms = await teacherClassrooms(session.uid, session.schoolId)
    const classroomIds = classrooms.map((c) => c.id)
    const groups = await db.subjectGroup.findMany({
      where: { classroomId: { in: classroomIds } },
      select: { id: true, name: true, classroomId: true, archivedAt: true },
      orderBy: { name: 'asc' },
    })
    const activeSessions = await db.liveSession.findMany({
      where: { classroomId: { in: classroomIds }, status: 'ACTIVE' },
      select: { id: true, title: true, classroomId: true, startedAt: true, announcedAt: true },
    })
    const activeByClassroom = new Map(activeSessions.map((s) => [s.classroomId, s]))
    return NextResponse.json({
      classrooms: classrooms.map((c) => ({
        ...c,
        // سقف مؤثر: حداقلِ سقف جهانی/مدرسه/کلاس — معلم نیز جزو ظرفیت است
        capacity: effectiveCapacity(c.capacity, c.schoolLiveMax),
        groups: groups
          .filter((g) => g.classroomId === c.id)
          .map((g) => ({ id: g.id, name: g.name, archived: !!g.archivedAt })),
        activeSession: activeByClassroom.get(c.id)
          ? {
              id: activeByClassroom.get(c.id)!.id,
              title: activeByClassroom.get(c.id)!.title,
              startedAt: activeByClassroom.get(c.id)!.startedAt.toISOString(),
              announcedAt: activeByClassroom.get(c.id)!.announcedAt?.toISOString() ?? null,
            }
          : null,
      })),
      maxParticipants: LIVE_MAX_PARTICIPANTS,
    })
  }

  if (session.role === 'STUDENT') {
    const schoolLive = await db.school.findUnique({
      where: { id: session.schoolId },
      select: { liveMaxParticipants: true },
    })
    const classrooms = await db.classroom.findMany({
      where: { schoolId: session.schoolId, enrollments: { some: { studentId: session.uid } } },
      select: { id: true, name: true, capacity: true },
      orderBy: { name: 'asc' },
    })
    const activeSessions = await db.liveSession.findMany({
      where: {
        classroomId: { in: classrooms.map((c) => c.id) },
        status: 'ACTIVE',
      },
      include: { host: { select: { fullName: true } } },
    })
    const byClassroom = new Map(activeSessions.map((s) => [s.classroomId, s]))
    return NextResponse.json({
      classrooms: classrooms.map((c) => {
        const s = byClassroom.get(c.id)
        return {
          ...c,
          // سقف مؤثر: حداقلِ سقف جهانی/مدرسه/کلاس — معلم نیز جزو ظرفیت است
          capacity: effectiveCapacity(c.capacity, schoolLive?.liveMaxParticipants ?? null),
          activeSession: s
            ? {
                id: s.id,
                title: s.title,
                hostName: s.host.fullName,
                startedAt: s.startedAt.toISOString(),
                // فقط جلسات «اعلام‌شده» دعوت پاپ‌آپ دارند؛ جلسه بدون استریم آماده،
                // هرگز در فهرست/پاپ‌آپ به‌عنوان «شروع‌شده» به دانش‌آموز نمایش داده نمی‌شود
                announcedAt: s.announcedAt?.toISOString() ?? null,
              }
            : null,
        }
      }),
      maxParticipants: LIVE_MAX_PARTICIPANTS,
    })
  }

  // مدیر مدرسه: همه جلسات فعال مدرسه (اطلاعات فقط مدرسهٔ خودش — بدون امکان تغییر سقف‌ها)
  const activeSessions = await db.liveSession.findMany({
    where: { classroom: { schoolId: session.schoolId }, status: 'ACTIVE' },
    include: {
      classroom: { select: { name: true } },
      host: { select: { id: true, fullName: true } },
    },
    orderBy: { startedAt: 'desc' },
  })
  const counts = await db.liveParticipantLog.groupBy({
    by: ['sessionId'],
    where: { sessionId: { in: activeSessions.map((s) => s.id) }, leftAt: null },
    _count: { sessionId: true },
  })
  const countMap = new Map(counts.map((c) => [c.sessionId, c._count.sessionId]))
  const schoolLimits = await db.school.findUnique({
    where: { id: session.schoolId },
    select: { liveMaxParticipants: true, liveMaxConcurrent: true },
  })
  return NextResponse.json({
    activeSessions: activeSessions.map((s) => ({
      id: s.id,
      title: s.title,
      classroomName: s.classroom.name,
      hostName: s.host.fullName,
      startedAt: s.startedAt.toISOString(),
      onlineCount: countMap.get(s.id) ?? 0,
    })),
    maxParticipants: LIVE_MAX_PARTICIPANTS,
    // محدودیت‌های تعیین‌شده مدیر کل — فقط برای اطلاع مدیر مدرسه (تغییر فقط از پنل مدیر کل)
    limits: {
      schoolMaxParticipants: effectiveCapacity(
        null,
        schoolLimits?.liveMaxParticipants ?? null,
      ),
      schoolLiveMaxParticipants: schoolLimits?.liveMaxParticipants ?? null,
      schoolLiveMaxConcurrent: schoolLimits?.liveMaxConcurrent ?? null,
      maxConcurrent: effectiveMaxConcurrent(schoolLimits?.liveMaxConcurrent ?? null),
      activeCount: activeSessions.length,
    },
  })
}

const MAX_TITLE = 120

/**
 * POST /api/live-sessions — ساخت جلسه فوری (فقط معلم منتسب به کلاس)
 * بدنه: { classroomId, notifyGroupId, title }
 * جلسه متعلق به کلاس است؛ گروه درسی فقط برای اطلاع‌رسانی (پیام دعوت خودکار + اعلان)
 *
 * نکته مهم «اعلام شروع کلاس»: این مسیر فقط جلسه را می‌سازد و هیچ اعلانی
 * ارسال نمی‌کند؛ اعلان شروع (پیام دعوت + اعلان/پوش + پاپ‌آپ) فقط پس از
 * آماده‌شدن استریم معلم توسط POST /api/live-sessions/[id]/announce ارسال
 * می‌شود — در صورت شکست استریم، هیچ اعلانی به دانش‌آموزان نمی‌رسد.
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role !== 'TEACHER') {
    return jsonError('فقط معلم می‌تواند جلسه آنلاین برگزار کند', 403)
  }

  const enabled = await onlineClassEnabled(session.schoolId)
  if (!enabled) return jsonError(ONLINE_CLASS_DISABLED_MSG, 403)

  // جلسات رهاشده اعلام‌نشده — پیش از بررسی «یک جلسه فعال» وضعیت واقعی تضمین شود
  await sweepUnannouncedSessions(session.schoolId).catch(() => {})

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const classroomId = String(body.classroomId ?? '')
  const notifyGroupId = String(body.notifyGroupId ?? '')
  const title = String(body.title ?? '').trim()

  if (!classroomId) return jsonError('کلاس جلسه باید مشخص باشد')
  if (!notifyGroupId) return jsonError('گروه درسی برای اطلاع‌رسانی باید انتخاب شود')
  if (!title) return jsonError('عنوان جلسه الزامی است')
  if (title.length > MAX_TITLE) return jsonError('عنوان جلسه بیش از حد بلند است')

  // کلاس باید در مدرسه خود معلم باشد و معلم به گروه‌های آن کلاس منتسب باشد
  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, schoolId: session.schoolId },
    select: { id: true, name: true, schoolId: true },
  })
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const assigned = await db.teachingAssignment.findFirst({
    where: { teacherId: session.uid, subjectGroup: { classroomId } },
    select: { id: true },
  })
  if (!assigned) return jsonError('شما به این کلاس اختصاص ندارید', 403)

  // گروه اطلاع‌رسانی باید از گروه‌های همان کلاس و غیر بایگانی باشد
  const notifyGroup = await db.subjectGroup.findFirst({
    where: { id: notifyGroupId, classroomId },
    select: { id: true, name: true, archivedAt: true },
  })
  if (!notifyGroup) return jsonError('گروه اطلاع‌رسانی باید از گروه‌های همین کلاس باشد', 400)
  if (notifyGroup.archivedAt) {
    return jsonError('این گروه بایگانی شده است؛ گروه دیگری را انتخاب کنید', 400)
  }

  // ── سقف جلسات هم‌زمان مدرسه (اعمال واقعی سمت سرور، نه فقط رابط کاربری) ──
  // سقف اختصاصی مدرسه (School.liveMaxConcurrent از پنل مدیر کل) یا سقف جهانی
  // LIVE_MAX_CONCURRENT_SESSIONS (۰ = نامحدود). جلسات رهاشدهٔ اعلام‌نشده با
  // sweep بالا تازه شده‌اند، پس شمارش واقعی است.
  const school = await db.school.findUnique({
    where: { id: session.schoolId },
    select: { liveMaxConcurrent: true },
  })
  const maxConcurrent = effectiveMaxConcurrent(school?.liveMaxConcurrent ?? null)
  if (maxConcurrent >= 1) {
    const activeCount = await db.liveSession.count({
      where: { classroom: { schoolId: session.schoolId }, status: 'ACTIVE' },
    })
    if (activeCount >= maxConcurrent) {
      return jsonError(
        `سقف جلسات هم‌زمان این مدرسه پر است (حداکثر ${maxConcurrent} جلسه)؛ برای جلسهٔ جدید یکی از جلسات جاری باید پایان یابد`,
        409,
      )
    }
  }

  // در هر کلاس فقط یک جلسه فعال — اما تلاش مجدد میزبان هرگز حلقه ارور نمی‌سازد:
  // ۱) جلسه نیمه‌کارهٔ خود معلم (اعلام‌نشده و بدون هیچ ورودی) → پایان تمیز و ساخت جلسه تازه
  // ۲) جلسه در جریانِ خود معلم → بازگشت همان جلسه (ورود مجدد بدون خطا)
  // ۳) جلسه معلم دیگر → ۴۰۹ مثل قبل
  const existing = await db.liveSession.findFirst({
    where: { classroomId, status: 'ACTIVE' },
    select: { id: true, hostId: true, announcedAt: true },
  })
  if (existing) {
    if (existing.hostId !== session.uid) {
      return jsonError('برای این کلاس یک جلسه فعال وجود دارد؛ ابتدا آن را پایان دهید', 409)
    }
    const participantCount = await db.liveParticipantLog.count({
      where: { sessionId: existing.id },
    })
    if (!existing.announcedAt && participantCount === 0) {
      // بقایای شروع ناموفق قبلیِ همین معلم — پایان تمیز و ساخت جلسه تازه با مشخصات جدید
      const now = new Date()
      const upd = await db.liveSession.updateMany({
        where: { id: existing.id, status: 'ACTIVE' },
        data: { status: 'ENDED', endedAt: now, enderId: session.uid },
      })
      if (upd.count > 0) {
        await db.liveParticipantLog
          .updateMany({ where: { sessionId: existing.id, leftAt: null }, data: { leftAt: now } })
          .catch(() => null)
        await notifySocket({
          rooms: [roomForUser(session.uid)],
          event: 'live:session-status',
          data: { sessionId: existing.id, status: 'ENDED' },
        })
      }
    } else {
      // جلسه در جریان خود معلم است (اعلام‌شده یا دارای شرکت‌کننده) → ورود مجدد بدون خطا
      return NextResponse.json({
        id: existing.id,
        reused: true,
        message: 'جلسه فعال این کلاس در جریان است؛ به جلسه وارد می‌شوید',
      })
    }
  }

  const created = await db.liveSession.create({
    data: {
      classroomId,
      hostId: session.uid,
      notifyGroupId,
      title,
      status: 'ACTIVE',
      // announcedAt همیشه null ساخته می‌شود — اعلام شروع مرحله جداگانه دارد
    },
  })

  // ── راستی‌آزمایی پس از ساخت (ضد رقابت دو ایجاد هم‌زمان) ──
  // اگر دو معلم هم‌لحظه از سقف رد شدند، جلسهٔ تازهٔ همین درخواست حذف و خطا
  // برمی‌گردد — شمارش هرگز از سقف عبور نمی‌کند.
  if (maxConcurrent >= 1) {
    const activeNow = await db.liveSession.count({
      where: { classroom: { schoolId: session.schoolId }, status: 'ACTIVE' },
    })
    if (activeNow > maxConcurrent) {
      await db.liveSession.delete({ where: { id: created.id } }).catch(() => null)
      return jsonError(
        `سقف جلسات هم‌زمان این مدرسه پر است (حداکثر ${maxConcurrent} جلسه)؛ برای جلسهٔ جدید یکی از جلسات جاری باید پایان یابد`,
        409,
      )
    }
  }

  await notifySocket({
    rooms: [roomForUser(session.uid)],
    event: 'live:list-changed',
    data: { sessionId: created.id, action: 'create' },
  })

  return NextResponse.json(
    {
      id: created.id,
      message: 'جلسه ساخته شد؛ پس از آماده‌شدن استریم شما، اعلان شروع کلاس ارسال می‌شود',
    },
    { status: 201 },
  )
}
