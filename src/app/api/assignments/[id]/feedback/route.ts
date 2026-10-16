import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  assignmentsEnabled,
  getAssignmentAccess,
  getAssignmentById,
  serializeSubmission,
} from '@/lib/assignment-access'
import { FEEDBACK_STATUSES, FEEDBACK_STATUS_LABELS, type FeedbackStatus } from '@/lib/assignment-status'
import { pushNotifications } from '@/lib/notifications'
import { notifySocket, roomForGroup } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/assignments/[id]/feedback — ثبت بازخورد و نمره برای پاسخ یک دانش‌آموز
 * فقط معلم منتسب به گروه. بازخورد فقط برای پاسخ ثبت‌شده ممکن است.
 * وضعیت‌ها: UNSEEN (بازنشانی) | APPROVED | REJECTED | INCOMPLETE
 */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'TEACHER') {
    return jsonError('فقط معلم گروه می‌تواند بازخورد ثبت کند', 403)
  }

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const assignment = await getAssignmentById(id)
  if (!assignment) return jsonError('تکلیف یافت نشد', 404)

  const access = await getAssignmentAccess(session, assignment)
  if (!access) return jsonError('تکلیف یافت نشد یا دسترسی ندارید', 404)
  if (access !== 'MANAGE') return jsonError('فقط معلم گروه می‌تواند بازخورد ثبت کند', 403)
  if (assignment.subjectGroup.archivedAt) {
    return jsonError('گروه این تکلیف بایگانی شده است', 403)
  }

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const studentId = String(body.studentId ?? '')
  const feedbackStatus = String(body.feedbackStatus ?? '')
  const note = body.note === null || body.note === undefined ? null : String(body.note).trim()
  const gradeRaw = body.grade

  if (!studentId) return jsonError('دانش‌آموز مشخص نشده است')
  if (!FEEDBACK_STATUSES.includes(feedbackStatus as FeedbackStatus)) {
    return jsonError('وضعیت بازخورد نامعتبر است')
  }

  // نمره: اختیاری — در صورت ارسال باید عددی در بازه مجاز باشد
  let grade: number | null = null
  if (gradeRaw !== null && gradeRaw !== undefined && gradeRaw !== '') {
    grade = Number(gradeRaw)
    const max = assignment.maxGrade ?? 100
    if (!Number.isInteger(grade) || grade < 0 || grade > max) {
      return jsonError(`نمره باید عددی بین ۰ تا ${max} باشد`)
    }
  }
  if (note && note.length > 1000) return jsonError('توضیح بازخورد بیش از حد بلند است')

  // عضو مؤثر بودن دانش‌آموز در گروه
  const target = await db.user.findFirst({
    where: { id: studentId, role: 'STUDENT', isActive: true },
    select: { id: true, fullName: true },
  })
  if (!target) return jsonError('دانش‌آموز یافت نشد', 404)

  const sub = await db.assignmentSubmission.findUnique({
    where: { assignmentId_studentId: { assignmentId: id, studentId } },
    include: { student: { select: { fullName: true } } },
  })
  if (!sub) {
    return jsonError('این دانش‌آموز هنوز پاسخی ارسال نکرده است', 400)
  }

  const reviewedAt = feedbackStatus === 'UNSEEN' ? null : new Date()

  const updated = await db.assignmentSubmission.update({
    where: { id: sub.id },
    data: {
      feedbackStatus,
      feedbackNote: note || null,
      grade,
      reviewedAt,
    },
    include: { student: { select: { fullName: true } } },
  })

  // اعلان ثبت بازخورد برای دانش‌آموز
  if (feedbackStatus !== 'UNSEEN' && reviewedAt) {
    const label = FEEDBACK_STATUS_LABELS[feedbackStatus as FeedbackStatus]
    const gradeText = grade !== null ? ` — نمره: ${new Intl.NumberFormat('fa-IR').format(grade)}` : ''
    await pushNotifications([
      {
        userId: studentId,
        type: 'FEEDBACK_POSTED',
        title: `بازخورد تکلیف: ${assignment.title}`,
        body: `${label}${gradeText}`,
        link: `/assignments/${id}`,
        dedupeKey: `fb:${sub.id}:${reviewedAt.getTime()}`,
      },
    ])
  }

  await notifySocket({
    rooms: [roomForGroup(assignment.subjectGroupId)],
    event: 'assignments:update',
    data: { assignmentId: id, action: 'feedback' },
  })

  return NextResponse.json({
    submission: serializeSubmission(updated, assignment.dueAt),
    message: 'بازخورد ثبت شد',
  })
}
