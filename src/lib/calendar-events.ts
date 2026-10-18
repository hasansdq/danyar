import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import { parseDateKey } from '@/lib/jalali'
import { teacherAssignedToClassroom } from '@/lib/live-access'
import { viceHasPermission } from '@/lib/vice-permissions'

/**
 * موتور تقویم آموزشی کلاسی — همه بررسی‌های دسترسی سمت سرور انجام می‌شود.
 * تقویم کاملاً کلاس‌محور است؛ رویداد «کل مدرسه» (classroomId = null، فقط مدیر)
 * در تقویم همه کلاس‌های همان مدرسه هم نمایش داده می‌شود.
 */

// انواع رویداد تقویم
export const CLASS_EVENT_TYPES = [
  'HOLIDAY',
  'EXAM',
  'HOMEWORK',
  'PARTY',
  'SPORTS',
  'ACADEMIC',
  'TRIP',
  'CUSTOM',
] as const
export type ClassEventType = (typeof CLASS_EVENT_TYPES)[number]

/** برچسب فارسی انواع رویداد (سمت سرور برای خطاها) */
export const CLASS_EVENT_TYPE_LABELS: Record<ClassEventType, string> = {
  HOLIDAY: 'تعطیل',
  EXAM: 'امتحان',
  HOMEWORK: 'تکلیف',
  PARTY: 'جشن',
  SPORTS: 'مسابقه ورزشی',
  ACADEMIC: 'مسابقه علمی',
  TRIP: 'اردو',
  CUSTOM: 'رویداد سفارشی',
}

export function isValidEventType(t: unknown): t is ClassEventType {
  return typeof t === 'string' && (CLASS_EVENT_TYPES as readonly string[]).includes(t)
}

export interface CalendarClassItem {
  id: string
  name: string
  studentCount: number
}

/**
 * کلاس‌های قابل دسترس در تقویم آموزشی بر اساس نقش:
 * - مدیر مدرسه: همه کلاس‌های مدرسه خودش
 * - معلم: کلاس‌هایی که از طریق گروه‌های درسی به آن‌ها منتسب است
 * - دانش‌آموز: کلاس‌هایی که در آن‌ها ثبت‌نام شده
 */
export async function calendarAccessibleClassrooms(
  session: SessionPayload & { schoolId: string },
): Promise<CalendarClassItem[]> {
  if (session.role === 'TEACHER') {
    const rows = await db.teachingAssignment.findMany({
      where: {
        teacherId: session.uid,
        subjectGroup: { classroom: { schoolId: session.schoolId } },
      },
      select: { subjectGroup: { select: { classroom: { select: { id: true, name: true } } } } },
    })
    const seen = new Map<string, string>()
    for (const r of rows) {
      const c = r.subjectGroup.classroom
      if (!c) continue
      seen.set(c.id, c.name)
    }
    const ids = [...seen.keys()]
    const counts = await Promise.all(
      ids.map((id) =>
        db.classroomEnrollment.count({
          where: { classroomId: id, student: { isActive: true } },
        }),
      ),
    )
    return ids.map((id, i) => ({ id, name: seen.get(id)!, studentCount: counts[i] }))
  }

  if (session.role === 'STUDENT') {
    const rows = await db.classroomEnrollment.findMany({
      where: { studentId: session.uid, classroom: { schoolId: session.schoolId } },
      select: { classroom: { select: { id: true, name: true } } },
      orderBy: { classroom: { name: 'asc' } },
    })
    return rows.map((r) => ({ id: r.classroom.id, name: r.classroom.name, studentCount: 0 }))
  }

  // مدیر مدرسه: همه کلاس‌های مدرسه خودش
  const classrooms = await db.classroom.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      _count: { select: { enrollments: { where: { student: { isActive: true } } } } },
    },
  })
  return classrooms.map((c) => ({ id: c.id, name: c.name, studentCount: c._count.enrollments }))
}

/** آیا کاربر می‌تواند تقویم این کلاس را ببیند؟ (دانش‌آموز عضو / معلم منتسب / مدیر همان مدرسه) */
export async function canViewClassCalendar(
  session: SessionPayload,
  classroom: { id: string; schoolId: string },
): Promise<boolean> {
  if (!session.schoolId || session.schoolId !== classroom.schoolId) return false
  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') return true
  if (session.role === 'TEACHER') return teacherAssignedToClassroom(session.uid, classroom.id)
  if (session.role === 'STUDENT') {
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { studentId: session.uid, classroomId: classroom.id },
      select: { id: true },
    })
    return !!enrolled
  }
  return false
}

/** آیا کاربر می‌تواند برای این کلاس رویداد ثبت کند؟ (فقط معلم منتسب یا مدیر/معاون همان مدرسه — معاون با مجوز ثبت رویداد) */
export async function canCreateClassEvent(
  session: SessionPayload,
  classroom: { id: string; schoolId: string },
): Promise<boolean> {
  if (!session.schoolId || session.schoolId !== classroom.schoolId) return false
  if (session.role === 'SCHOOL_ADMIN') return true
  if (session.role === 'SCHOOL_VICE') {
    // معاون: ثبت رویداد تقویم قابل محدودیت از طرف مدیر مدرسه است
    return viceHasPermission(session, 'calendar_events')
  }
  if (session.role === 'TEACHER') return teacherAssignedToClassroom(session.uid, classroom.id)
  return false
}

/** اعتبارسنجی پارامترهای بازه GET رویدادها */
export function validateRangeParams(from: unknown, to: unknown):
  | { ok: true; from: string; to: string }
  | { ok: false; error: string } {
  const f = parseDateKey(from)
  const t = parseDateKey(to)
  if (!f || !t) return { ok: false, error: 'بازه تاریخ نامعتبر است' }
  if (f > t) return { ok: false, error: 'بازه تاریخ نامعتبر است' }
  return { ok: true, from: from as string, to: to as string }
}
