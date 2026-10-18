import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import { getSchoolFeatures } from '@/lib/chat-access'
import { teacherAssignedToClassroom } from '@/lib/live-access'
import { viceHasPermission } from '@/lib/vice-permissions'

/**
 * موتور دسترسی حضور و غیاب — همه بررسی‌ها سمت سرور انجام می‌شود.
 * هر فهرست حضور و غیاب متعلق به یک کلاس و یک جلسه مشخص است
 * و به گروه درسی وابسته نیست؛ دسترسی فقط از طریق کلاس بررسی می‌شود.
 */

export async function attendanceEnabled(schoolId: string): Promise<boolean> {
  const features = await getSchoolFeatures(schoolId)
  return features.attendance
}

/** کلاس‌های قابل دسترس برای ثبت/مشاهده حضور و غیاب بر اساس نقش */
export async function accessibleClassrooms(
  session: SessionPayload & { schoolId: string },
): Promise<{ id: string; name: string; studentCount: number }[]> {
  if (session.role === 'TEACHER') {
    const rows = await db.teachingAssignment.findMany({
      where: { teacherId: session.uid, subjectGroup: { classroom: { schoolId: session.schoolId } } },
      select: { subjectGroup: { select: { classroom: { select: { id: true, name: true } } } } },
    })
    const seen = new Map<string, { id: string; name: string }>()
    for (const r of rows) {
      const c = r.subjectGroup.classroom
      if (!c) continue
      if (!seen.has(c.id)) seen.set(c.id, { id: c.id, name: c.name })
    }
    const ids = [...seen.keys()]
    const counts = await Promise.all(
      ids.map((id) =>
        db.classroomEnrollment.count({
          where: { classroomId: id, student: { isActive: true } },
        }),
      ),
    )
    return ids.map((id, i) => ({ id, name: seen.get(id)!.name, studentCount: counts[i] }))
  }
  // مدیر مدرسه: همه کلاس‌های مدرسه خودش
  const classrooms = await db.classroom.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { enrollments: { where: { student: { isActive: true } } } } } },
  })
  return classrooms.map((c) => ({
    id: c.id,
    name: c.name,
    studentCount: c._count.enrollments,
  }))
}

/** آیا این کاربر می‌تواند جلسه حضور و غیاب را ببیند/ویرایش کند؟ (معلم منتسب کلاس یا مدیر/معاون همان مدرسه — معاون با مجوز attendance) */
export async function canManageAttendanceSession(
  session: SessionPayload,
  att: { classroomId: string },
  classroomSchoolId: string,
): Promise<boolean> {
  if (!session.schoolId || session.schoolId !== classroomSchoolId) return false
  if (session.role === 'SCHOOL_ADMIN') return true
  if (session.role === 'SCHOOL_VICE') {
    // معاون: مدیریت حضور و غیاب قابل محدودیت از طرف مدیر مدرسه است
    return viceHasPermission(session, 'attendance')
  }
  if (session.role === 'TEACHER') {
    return teacherAssignedToClassroom(session.uid, att.classroomId)
  }
  return false
}

/** وضعیت‌های مجاز رکورد حضور */
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]

export function statusLabel(s: string): string {
  if (s === 'PRESENT') return 'حاضر'
  if (s === 'ABSENT') return 'غایب'
  return 'ثبت‌نشده'
}

/**
 * پیام اخطار اجباری‌بودن «عنوان نمره» (درخواست کاربر — عین متن):
 * اگر معلم برای حداقل یک دانش‌آموز نمره ثبت کند و بدون عنوان نمره فرم را ثبت کند.
 */
export const GRADE_TITLE_REQUIRED_MSG =
  'لطفاً عنوان نمره‌ای که برای دانش‌آموزان ثبت کرده‌اید را وارد نمایید'

/**
 * پیام اخطار اجباری‌بودن «درس» (درخواست کاربر):
 * فیلد کشویی انتخاب درس اجباری است — بدون درس، نمره ثبت نمی‌شود.
 */
export const GRADE_LESSON_REQUIRED_MSG = 'لطفاً درس مربوط به نمرات ثبت‌شده را انتخاب کنید'
