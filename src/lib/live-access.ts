import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import { parseFeatures } from '@/lib/features'

/**
 * موتور دسترسی کلاس آنلاین — همه بررسی‌ها سمت سرور انجام می‌شود.
 * داشتن لینک یا شناسه جلسه به‌تنهایی هیچ دسترسی‌ای ایجاد نمی‌کند.
 */

/**
 * فعال‌بودن کلاس آنلاین مدرسه — مدرسهٔ غیرفعال/حذف‌شده همیشه مسدود است
 * (هماهنگ با بررسی سرویس سوکت در getOrLoadRoom — یک منبع حقیقت).
 */
export async function onlineClassEnabled(schoolId: string): Promise<boolean> {
  if (!schoolId) return false
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { isActive: true, features: true },
  })
  if (!school || !school.isActive) return false
  return parseFeatures(school.features).onlineClass
}

/** کلاس‌های معلم بر اساس انتساب واقعی به گروه‌ها (بدون تکرار) — با ظرفیت اختصاصی و سقف مدرسه */
export async function teacherClassrooms(teacherId: string, schoolId: string) {
  const rows = await db.teachingAssignment.findMany({
    where: { teacherId, subjectGroup: { classroom: { schoolId } } },
    select: {
      subjectGroup: {
        select: {
          classroom: {
            select: {
              id: true,
              name: true,
              capacity: true,
              school: { select: { liveMaxParticipants: true } },
            },
          },
        },
      },
    },
  })
  const seen = new Map<
    string,
    { id: string; name: string; capacity: number | null; schoolLiveMax: number | null }
  >()
  for (const r of rows) {
    const c = r.subjectGroup.classroom
    if (!c) continue
    if (!seen.has(c.id))
      seen.set(c.id, {
        id: c.id,
        name: c.name,
        capacity: c.capacity,
        schoolLiveMax: c.school?.liveMaxParticipants ?? null,
      })
  }
  return [...seen.values()]
}

/** آیا معلم به این کلاس (از طریق گروه‌هایش) منتسب است؟ */
export async function teacherAssignedToClassroom(
  teacherId: string,
  classroomId: string,
): Promise<boolean> {
  const assigned = await db.teachingAssignment.findFirst({
    where: { teacherId, subjectGroup: { classroomId } },
    select: { id: true },
  })
  return !!assigned
}

/** دسترسی دیدن جلسه: معلم منتسب، دانش‌آموز ثبت‌نام‌شده همان کلاس، مدیر/معاون همان مدرسه */
export async function canAccessClassroom(
  session: SessionPayload,
  classroom: { id: string; schoolId: string },
): Promise<boolean> {
  if (!session.schoolId || session.schoolId !== classroom.schoolId) return false
  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') return true
  if (session.role === 'TEACHER') {
    return teacherAssignedToClassroom(session.uid, classroom.id)
  }
  if (session.role === 'STUDENT') {
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { studentId: session.uid, classroomId: classroom.id },
      select: { id: true },
    })
    return !!enrolled
  }
  return false
}

export interface LiveSessionFull {
  id: string
  title: string
  status: string
  startedAt: Date
  /** اعلام رسمی شروع کلاس — null یعنی استریم معلم هنوز آماده نشده و اعلانی ارسال نشده */
  announcedAt?: Date | null
  endedAt: Date | null
  forceEndReason?: string | null
  classroomId: string
  classroom: {
    id: string
    name: string
    schoolId: string
    capacity: number | null
    /** سقف اختصاصی جلسهٔ مدرسه — برای محاسبهٔ ظرفیت مؤثر */
    school?: { liveMaxParticipants: number | null } | null
  }
  hostId: string
  host: { id: string; fullName: string }
  notifyGroupId: string | null
  notifyGroup: { id: string; name: string } | null
}

export function getLiveSessionById(id: string) {
  return db.liveSession.findUnique({
    where: { id },
    include: {
      classroom: {
        select: {
          id: true,
          name: true,
          schoolId: true,
          capacity: true,
          school: { select: { liveMaxParticipants: true } },
        },
      },
      host: { select: { id: true, fullName: true } },
      notifyGroup: { select: { id: true, name: true } },
    },
  }) as Promise<LiveSessionFull | null>
}

/** آیا این کاربر می‌تواند جلسه را پایان دهد؟ (معلم میزبان یا مدیر/معاون همان مدرسه) */
export async function canEndLiveSession(
  session: SessionPayload,
  live: { hostId: string; classroom: { schoolId: string } },
): Promise<boolean> {
  if (session.role === 'TEACHER') return live.hostId === session.uid
  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') {
    return !!session.schoolId && session.schoolId === live.classroom.schoolId
  }
  return false
}

/**
 * سرورهای ICE از متغیرهای محیطی (STUN/TURN قابل پیکربندی).
 *
 * نکتهٔ حیاتی: livekit-client فقط وقتی iceServers از سمت کلاینت نفرستاده شود
 * از iceServers «خود سرور» (ارسالی در پاسخ join) استفاده می‌کند — فرستادن
 * آرایهٔ صرفاً-STUN ناخواسته TURN سرور رسانه را حذف می‌کند. پس:
 * - رسانهٔ بیرونی (NEXT_PUBLIC_LIVEKIT_WS_URL، مثل LiveKit Cloud) بدون TURNِ
 *   صریحِ مدیر → آرایهٔ خالی برمی‌گردد تا کلاینت هیچ iceServers ندهد و STUN/TURN
 *   خود آن سرویس (شامل TURN/TLS) اعمال شود.
 * - TURN صریح تنظیم شده → همیشه همراه STUN ارسال می‌شود (شبکه‌های محدود).
 * - حالت محلی/هم‌میزبان → رفتار قبلی (STUN پیش‌فرض + TURN اختیاری).
 */
export function iceServersConfig(): RTCIceServerLike[] {
  const externalMedia = !!(process.env.NEXT_PUBLIC_LIVEKIT_WS_URL ?? '').trim()
  const explicitTurn = (process.env.LIVE_TURN_URLS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (externalMedia && explicitTurn.length === 0) {
    // سرویس بیرونی خودش STUN/TURN کامل می‌فرستد — نباید سرکوب شود
    return []
  }
  const stun = (process.env.LIVE_STUN_URLS ?? 'stun:stun.l.google.com:19302')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: RTCIceServerLike[] = []
  if (stun.length) out.push({ urls: stun })
  if (explicitTurn.length) {
    out.push({
      urls: explicitTurn,
      username: process.env.LIVE_TURN_USERNAME || undefined,
      credential: process.env.LIVE_TURN_CREDENTIAL || undefined,
    })
  }
  return out
}

export interface RTCIceServerLike {
  urls: string | string[]
  username?: string
  credential?: string
}

/** سقف شرکت‌کنندگان (هماهنگ با سرویس socket و docker-compose و .env.example — پیش‌فرض ۳۲) */
export const LIVE_MAX_PARTICIPANTS = Math.max(
  2,
  Number(process.env.LIVE_MAX_PARTICIPANTS ?? 32),
)

/** سقف جهانی تعداد جلسات هم‌زمان هر مدرسه — ۰/نامعتبر = نامحدود */
export const LIVE_MAX_CONCURRENT_SESSIONS = (() => {
  const n = Number(process.env.LIVE_MAX_CONCURRENT_SESSIONS ?? 0)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0
})()

/** سقف اختصاصی مدرسه معتبر؟ (۲ تا ۵۰۰ — همان دامنهٔ ظرفیت کلاس) */
export function validSchoolLiveMaxParticipants(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 500
}

/** سقف جلسات هم‌زمان مدرسه معتبر؟ (۱ تا ۱۰۰) */
export function validSchoolLiveMaxConcurrent(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 100
}

/** سقف مؤثر جلسات هم‌زمان مدرسه: مقدار مدرسه یا سقف جهانی (۰ = نامحدود) */
export function effectiveMaxConcurrent(
  schoolLiveMaxConcurrent: number | null | undefined,
): number {
  const c = Number(schoolLiveMaxConcurrent ?? 0)
  if (Number.isFinite(c) && c >= 1) return Math.floor(c)
  return LIVE_MAX_CONCURRENT_SESSIONS
}

/**
 * سقف مؤثر یک جلسه از این کلاس: حداقلِ (به ترتیب اولویت محدودیت):
 * ۱) سقف جهانی LIVE_MAX_PARTICIPANTS (پیش‌فرض ۳۲)
 * ۲) سقف اختصاصی مدرسه School.liveMaxParticipants (پنل مدیر کل)
 * ۳) ظرفیت اختصاصی کلاس Classroom.capacity (پنل مدیر کل)
 * مقدار null/۰/منفی هر لایه = بدون سقف اختصاصی همان لایه.
 * معلم میزبان نیز جزو این ظرفیت محسوب می‌شود (سوکت او را هم می‌شمارد).
 * این سقف محدودیت نرم‌افزاری ورود است — تضمین توان سخت‌افزاری برای آن تعداد کاربر نیست.
 */
export function effectiveCapacity(
  classroomCapacity: number | null | undefined,
  schoolLiveMaxParticipants: number | null | undefined = null,
): number {
  let cap = LIVE_MAX_PARTICIPANTS
  const s = Number(schoolLiveMaxParticipants ?? 0)
  if (Number.isFinite(s) && s >= 2) cap = Math.min(cap, Math.floor(s))
  const c = Number(classroomCapacity ?? 0)
  if (Number.isFinite(c) && c >= 2) cap = Math.min(cap, Math.floor(c))
  return cap
}

/**
 * محدودیت‌های زندهٔ کلاس آنلاین یک مدرسه — منبع واحد برای APIها و سوکت.
 */
export interface SchoolLiveLimits {
  onlineClass: boolean
  liveMaxParticipants: number | null
  liveMaxConcurrent: number | null
  isActive: boolean
}

export async function getSchoolLiveLimits(schoolId: string): Promise<SchoolLiveLimits | null> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { isActive: true, features: true, liveMaxParticipants: true, liveMaxConcurrent: true },
  })
  if (!school) return null
  let onlineClass = false
  try {
    onlineClass = (JSON.parse(school.features) as { onlineClass?: boolean })?.onlineClass === true
  } catch {
    onlineClass = false
  }
  return {
    onlineClass,
    liveMaxParticipants: school.liveMaxParticipants,
    liveMaxConcurrent: school.liveMaxConcurrent,
    isActive: school.isActive,
  }
}
