import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import { getSchoolFeatures } from '@/lib/chat-access'
import { teacherAssignedToClassroom } from '@/lib/live-access'

/**
 * موتور دسترسی کتابخانه نمونه‌سؤالات — همه بررسی‌ها سمت سرور انجام می‌شود.
 * نمونه‌سؤال متعلق به کلاس‌های انتخاب‌شده است و به گروه درسی وابسته نیست؛
 * دانستن شناسه نمونه‌سؤال، کلاس یا فایل به‌تنهایی هیچ دسترسی‌ای ایجاد نمی‌کند.
 */

export async function sampleQEnabled(schoolId: string): Promise<boolean> {
  const features = await getSchoolFeatures(schoolId)
  return features.sampleq
}

export const SAMPLEQ_STATUSES = ['PUBLISHED', 'UNPUBLISHED'] as const
export type SampleQuestionStatus = (typeof SAMPLEQ_STATUSES)[number]

export const SAMPLEQ_FILE_ROLES = ['QUESTION', 'ANSWER'] as const
export type SampleQFileRole = (typeof SAMPLEQ_FILE_ROLES)[number]

export interface SampleQuestionWithClasses {
  id: string
  schoolId: string
  title: string
  subject: string
  topic: string | null
  description: string
  showAnswer: boolean
  status: string
  publishedAt: Date | null
  createdById: string
  createdAt: Date
  updatedAt: Date
  createdBy: { id: string; fullName: string; role: string }
  classes: {
    classroom: { id: string; name: string; schoolId: string }
  }[]
}

export function getSampleQuestionById(id: string) {
  return db.sampleQuestion.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, fullName: true, role: true } },
      classes: {
        include: {
          classroom: { select: { id: true, name: true, schoolId: true } },
        },
      },
    },
  }) as Promise<SampleQuestionWithClasses | null>
}

export type SampleQuestionAccess = 'MANAGE' | 'VIEW'

/**
 * سطح دسترسی به نمونه‌سؤال:
 * - معلم سازنده → MANAGE (ویرایش/حذف/انتشار)
 * - مدیر مدرسه همان مدرسه → VIEW (مشاهده و مدیریت کل مدرسه)
 * - دانش‌آموز ثبت‌نام‌شده در حداقل یکی از کلاس‌های مخاطب، فقط اگر منتشرشده باشد → VIEW
 * بقیه (حتی با دانستن شناسه) → null
 */
export async function getSampleQuestionAccess(
  session: SessionPayload,
  question: SampleQuestionWithClasses,
): Promise<SampleQuestionAccess | null> {
  if (!session.schoolId || question.schoolId !== session.schoolId) return null

  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') return 'VIEW'

  if (session.role === 'TEACHER') {
    return question.createdById === session.uid ? 'MANAGE' : null
  }

  if (session.role === 'STUDENT') {
    if (question.status !== 'PUBLISHED') return null
    const classIds = question.classes.map((c) => c.classroom.id)
    if (!classIds.length) return null
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { studentId: session.uid, classroomId: { in: classIds } },
      select: { id: true },
    })
    return enrolled ? 'VIEW' : null
  }

  return null
}

/** آیا معلم به این کلاس (از طریق انتساب گروه‌های درسی) مجاز است؟ */
export async function teacherCanUseClassroom(
  teacherId: string,
  classroomId: string,
  schoolId: string,
): Promise<boolean> {
  const classroom = await db.classroom.findFirst({
    where: { id: classroomId, schoolId },
    select: { id: true },
  })
  if (!classroom) return false
  return teacherAssignedToClassroom(teacherId, classroomId)
}

/** دانش‌آموزان فعال ثبت‌نام‌شده در کلاس‌های داده‌شده (بدون تکرار) */
export async function activeStudentsOfClassrooms(
  classroomIds: string[],
): Promise<{ id: string; fullName: string; isActive: boolean }[]> {
  if (!classroomIds.length) return []
  const enrollments = await db.classroomEnrollment.findMany({
    where: { classroomId: { in: classroomIds }, student: { isActive: true } },
    select: {
      student: { select: { id: true, fullName: true, isActive: true } },
    },
  })
  const map = new Map<string, { id: string; fullName: string; isActive: boolean }>()
  for (const e of enrollments) map.set(e.student.id, e.student)
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
}

/** کلاس‌های مجاز معلم برای ایجاد نمونه‌سؤال (از طریق انتساب گروه‌های درسی) */
export async function teacherAllowedClassrooms(
  teacherId: string,
  schoolId: string,
): Promise<{ id: string; name: string; studentCount: number }[]> {
  const rows = await db.teachingAssignment.findMany({
    where: { teacherId, subjectGroup: { classroom: { schoolId } } },
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

/** برچسب فارسی وضعیت انتشار */
export function statusLabel(status: string): string {
  return status === 'PUBLISHED' ? 'منتشرشده' : 'پیش‌نویس'
}
