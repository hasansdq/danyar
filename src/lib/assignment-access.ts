import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import {
  getSchoolFeatures,
  isEffectiveStudentMember,
} from '@/lib/chat-access'
import {
  computeSubmissionStatus,
  type SubmissionStatus,
} from '@/lib/assignment-status'

/**
 * موتور دسترسی تکالیف — همه بررسی‌ها سمت سرور انجام می‌شود.
 * دانستن شناسه تکلیف یا پاسخ به‌تنهایی هیچ دسترسی‌ای ایجاد نمی‌کند.
 */

export interface AssignmentWithGroup {
  id: string
  subjectGroupId: string
  title: string
  description: string
  answerMode: string
  allowEdit: boolean
  maxGrade: number | null
  dueAt: Date | null
  attachmentName: string | null
  attachmentKey: string | null
  attachmentMime: string | null
  attachmentSize: number | null
  createdById: string
  createdAt: Date
  subjectGroup: {
    id: string
    name: string
    archivedAt: Date | null
    classroom: { id: string; name: string; schoolId: string }
  }
}

export function getAssignmentById(id: string) {
  return db.assignment.findUnique({
    where: { id },
    include: {
      subjectGroup: {
        select: {
          id: true,
          name: true,
          archivedAt: true,
          classroom: { select: { id: true, name: true, schoolId: true } },
        },
      },
    },
  }) as Promise<AssignmentWithGroup | null>
}

/** آیا امکانات تکالیف برای مدرسه فعال است؟ */
export async function assignmentsEnabled(schoolId: string): Promise<boolean> {
  const features = await getSchoolFeatures(schoolId)
  return features.assignments
}

export type AssignmentAccess = 'MANAGE' | 'VIEW'

/**
 * سطح دسترسی به تکلیف:
 * - معلم منتسب به گروه → MANAGE
 * - مدیر مدرسه همان مدرسه → VIEW
 * - دانش‌آموز عضو مؤثر گروه → VIEW
 * بقیه (حتی با دانستن شناسه) → null
 */
export async function getAssignmentAccess(
  session: SessionPayload,
  assignment: AssignmentWithGroup,
): Promise<AssignmentAccess | null> {
  const schoolId = assignment.subjectGroup.classroom.schoolId
  if (session.schoolId !== schoolId) return null

  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') return 'VIEW'

  if (session.role === 'TEACHER') {
    const assigned = await db.teachingAssignment.findFirst({
      where: { teacherId: session.uid, subjectGroupId: assignment.subjectGroupId },
      select: { id: true },
    })
    return assigned ? 'MANAGE' : null
  }

  if (session.role === 'STUDENT') {
    const member = await isEffectiveStudentMember(
      assignment.subjectGroupId,
      assignment.subjectGroup.classroom.id,
      session.uid,
    )
    return member ? 'VIEW' : null
  }

  return null
}

/** دانش‌آموزان عضو مؤثر یک گروه (ثبت‌نام کلاس − استثنا + افزودنی‌ها) */
export async function effectiveGroupStudents(
  groupId: string,
  classroomId: string,
): Promise<{ id: string; fullName: string; isActive: boolean }[]> {
  const enrollments = await db.classroomEnrollment.findMany({
    where: { classroomId },
    select: {
      student: { select: { id: true, fullName: true, isActive: true } },
    },
  })
  const map = new Map<string, { id: string; fullName: string; isActive: boolean }>()
  for (const e of enrollments) map.set(e.student.id, e.student)

  const overrides = await db.groupMemberOverride.findMany({
    where: { subjectGroupId: groupId },
    select: { userId: true, action: true },
  })
  for (const o of overrides) {
    if (o.action === 'REMOVE') {
      map.delete(o.userId)
    } else if (o.action === 'ADD' && !map.has(o.userId)) {
      const u = await db.user.findUnique({
        where: { id: o.userId },
        select: { id: true, fullName: true, isActive: true },
      })
      if (u) map.set(u.id, u)
    }
  }
  return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
}

export interface SerializedSubmission {
  id: string
  assignmentId: string
  studentId: string
  studentName: string
  text: string
  file: { url: string; name: string; mime: string; size: number } | null
  submittedAt: string
  editedAt: string | null
  feedbackStatus: string
  feedbackNote: string | null
  grade: number | null
  reviewedAt: string | null
  status: SubmissionStatus
}

/** سریال‌سازی پاسخ دانش‌آموز برای نمایش (بدون افشای داده به غیرمجاز) */
export function serializeSubmission(
  sub: {
    id: string
    assignmentId: string
    studentId: string
    student: { fullName: string }
    text: string
    fileName: string | null
    fileKey: string | null
    fileMime: string | null
    fileSize: number | null
    submittedAt: Date
    editedAt: Date | null
    feedbackStatus: string
    feedbackNote: string | null
    grade: number | null
    reviewedAt: Date | null
  },
  dueAt: Date | null,
): SerializedSubmission {
  return {
    id: sub.id,
    assignmentId: sub.assignmentId,
    studentId: sub.studentId,
    studentName: sub.student.fullName,
    text: sub.text,
    file:
      sub.fileKey && sub.fileName
        ? {
            url: `/api/submissions/${sub.id}/file`,
            name: sub.fileName,
            mime: sub.fileMime ?? 'application/octet-stream',
            size: sub.fileSize ?? 0,
          }
        : null,
    submittedAt: sub.submittedAt.toISOString(),
    editedAt: sub.editedAt?.toISOString() ?? null,
    feedbackStatus: sub.feedbackStatus,
    feedbackNote: sub.feedbackNote,
    grade: sub.grade,
    reviewedAt: sub.reviewedAt?.toISOString() ?? null,
    status: computeSubmissionStatus(
      { submittedAt: sub.submittedAt.toISOString(), reviewedAt: sub.reviewedAt?.toISOString() ?? null },
      dueAt?.toISOString() ?? null,
    ),
  }
}

export interface AssignmentStats {
  total: number
  submitted: number
  late: number
  notSubmitted: number
  reviewed: number
  awaitingReview: number
}

/** آمار وضعیت‌ها از روی فهرست وضعیت‌ها */
export function statsFromStatuses(
  rows: { status: SubmissionStatus; feedbackStatus: string }[],
): AssignmentStats {
  const stats: AssignmentStats = {
    total: rows.length,
    submitted: 0,
    late: 0,
    notSubmitted: 0,
    reviewed: 0,
    awaitingReview: 0,
  }
  for (const r of rows) {
    if (r.status === 'NOT_SUBMITTED') stats.notSubmitted++
    else {
      stats.submitted++
      if (r.status === 'LATE') stats.late++
      else if (r.status === 'REVIEWED') stats.reviewed++
      if (r.feedbackStatus === 'UNSEEN') stats.awaitingReview++
    }
  }
  return stats
}
