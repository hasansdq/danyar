import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  assignmentsEnabled,
  effectiveGroupStudents,
  getAssignmentAccess,
  getAssignmentById,
  statsFromStatuses,
} from '@/lib/assignment-access'
import { computeSubmissionStatus } from '@/lib/assignment-status'
import { getSchoolFeatures } from '@/lib/chat-access'
import { serializeMessage } from '@/lib/messaging'
import { notifySocket, roomForGroup } from '@/lib/notify'

/** متن پیام خودکار تکلیف */
function announceBody(title: string, dueAt: Date | null): string {
  const dueText = dueAt
    ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(dueAt)
    : 'بدون مهلت'
  return `تکلیف «${title}» در این گروه ثبت شد.\nمهلت ارسال: ${dueText}`
}

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/assignments/[id] — جزئیات تکلیف متناسب با نقش
 * - دانش‌آموز: مشخصات + پاسخ خودش (فقط خودش)
 * - معلم منتسب: مشخصات + آمار (فهرست پاسخ‌ها از endpoint مجزای submissions)
 * - مدیر مدرسه: مشخصات + آمار (فقط‌خواندنی)
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const assignment = await getAssignmentById(id)
  if (!assignment) return jsonError('تکلیف یافت نشد', 404)

  const access = await getAssignmentAccess(session, assignment)
  if (!access) return jsonError('تکلیف یافت نشد یا دسترسی ندارید', 404)

  const base = {
    id: assignment.id,
    title: assignment.title,
    description: assignment.description,
    answerMode: assignment.answerMode,
    allowEdit: assignment.allowEdit,
    maxGrade: assignment.maxGrade,
    dueAt: assignment.dueAt?.toISOString() ?? null,
    createdAt: assignment.createdAt.toISOString(),
    subjectGroupId: assignment.subjectGroupId,
    groupName: assignment.subjectGroup.name,
    classroomName: assignment.subjectGroup.classroom.name,
    archived: !!assignment.subjectGroup.archivedAt,
    teacherName: (
      await db.user.findUnique({
        where: { id: assignment.createdById },
        select: { fullName: true },
      })
    )?.fullName ?? '',
    attachment:
      assignment.attachmentKey && assignment.attachmentName
        ? {
            url: `/api/assignments/${assignment.id}/attachment`,
            name: assignment.attachmentName,
            mime: assignment.attachmentMime ?? 'application/octet-stream',
            size: assignment.attachmentSize ?? 0,
          }
        : null,
  }

  if (session.role === 'STUDENT') {
    const sub = await db.assignmentSubmission.findUnique({
      where: { assignmentId_studentId: { assignmentId: id, studentId: session.uid } },
      include: { student: { select: { fullName: true } } },
    })
    return NextResponse.json({
      access: 'VIEW' as const,
      role: 'STUDENT' as const,
      assignment: base,
      mySubmission: sub
        ? {
            id: sub.id,
            text: sub.text,
            file:
              sub.fileKey && sub.fileName
                ? {
                    url: `/api/submissions/${sub.id}/file`,
                    name: sub.fileName,
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
              {
                submittedAt: sub.submittedAt.toISOString(),
                reviewedAt: sub.reviewedAt?.toISOString() ?? null,
              },
              assignment.dueAt?.toISOString() ?? null,
            ),
          }
        : null,
    })
  }

  // معلم / مدیر مدرسه — آمار کلی
  const students = await effectiveGroupStudents(
    assignment.subjectGroupId,
    assignment.subjectGroup.classroom.id,
  )
  const subs = await db.assignmentSubmission.findMany({
    where: { assignmentId: id },
    select: {
      studentId: true,
      submittedAt: true,
      reviewedAt: true,
      feedbackStatus: true,
    },
  })
  const studentIds = new Set(students.map((s) => s.id))
  const stats = statsFromStatuses(
    subs
      .filter((s) => studentIds.has(s.studentId))
      .map((s) => ({
        status: computeSubmissionStatus(
          {
            submittedAt: s.submittedAt.toISOString(),
            reviewedAt: s.reviewedAt?.toISOString() ?? null,
          },
          assignment.dueAt?.toISOString() ?? null,
        ),
        feedbackStatus: s.feedbackStatus,
      })),
  )

  return NextResponse.json({
    access,
    role: session.role,
    assignment: base,
    stats,
  })
}

const MAX_TITLE = 120
const MAX_DESC = 4000

/**
 * PATCH /api/assignments/[id] — ویرایش تکلیف (فقط معلم منتسب به گروه؛ گروه تکلیف قابل تغییر نیست)
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'TEACHER') return jsonError('فقط معلم می‌تواند تکلیف را ویرایش کند', 403)

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const assignment = await getAssignmentById(id)
  if (!assignment) return jsonError('تکلیف یافت نشد', 404)
  const access = await getAssignmentAccess(session, assignment)
  if (!access) return jsonError('تکلیف یافت نشد یا دسترسی ندارید', 404)
  if (access !== 'MANAGE') return jsonError('فقط معلم می‌تواند تکلیف را ویرایش کند', 403)
  if (assignment.subjectGroup.archivedAt)
    return jsonError('این گروه بایگانی شده و امکان ویرایش تکلیف نیست', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  if (body.subjectGroupId && String(body.subjectGroupId) !== assignment.subjectGroupId) {
    return jsonError('گروه درسی تکلیف قابل تغییر نیست')
  }

  const title = String(body.title ?? assignment.title).trim()
  const description = String(body.description ?? assignment.description).trim()
  const answerMode = String(body.answerMode ?? assignment.answerMode)
  const allowEdit = body.allowEdit === true
  const maxGrade =
    body.maxGrade === null || body.maxGrade === undefined || body.maxGrade === ''
      ? null
      : Number(body.maxGrade)
  let dueAt: Date | null = assignment.dueAt
  if ('dueAt' in body) {
    dueAt = body.dueAt ? new Date(String(body.dueAt)) : null
    if (dueAt && isNaN(dueAt.getTime())) return jsonError('مهلت ارسال نامعتبر است')
  }

  if (!title) return jsonError('عنوان تکلیف الزامی است')
  if (title.length > MAX_TITLE) return jsonError('عنوان تکلیف بیش از حد بلند است')
  if (description.length > MAX_DESC) return jsonError('توضیحات بیش از حد بلند است')
  if (!['TEXT', 'FILE', 'BOTH'].includes(answerMode))
    return jsonError('نحوه ارسال پاسخ نامعتبر است')
  if (maxGrade !== null && (!Number.isInteger(maxGrade) || maxGrade < 1 || maxGrade > 1000))
    return jsonError('نمره بیشینه باید عددی بین ۱ تا ۱۰۰۰ باشد')

  // پیوست جدید (اختیاری): فقط در صورت ارسال کلید جدید جایگزین می‌شود
  let att: {
    attachmentName: string
    attachmentKey: string
    attachmentMime: string
    attachmentSize: number
  } | null = null
  if (body.attachment?.key) {
    const key = String(body.attachment.key)
    if (key.includes('..') || key.startsWith('/')) return jsonError('پیوست نامعتبر است')
    const meta = await db.upload.findUnique({ where: { key } }).catch(() => null)
    if (!meta) return jsonError('فایل آپلودشده یافت نشد؛ دوباره تلاش کنید', 400)
    if (meta.uploaderId !== session.uid) return jsonError('پیوست نامعتبر است', 400)
    att = {
      attachmentName: meta.name,
      attachmentKey: meta.key,
      attachmentMime: meta.mime,
      attachmentSize: meta.size,
    }
  }

  await db.assignment.update({
    where: { id },
    data: {
      title,
      description,
      answerMode,
      allowEdit,
      maxGrade,
      dueAt,
      ...(att ?? {}),
    },
  })

  // ردیف Upload به‌عنوان کتابخانه رسانه پلتفرم باقی می‌ماند (گالری مدیر کل + شمارش دانلود)

  // هماهنگ‌سازی پیام خودکار تکلیف با عنوان/مهلت جدید
  const announce = await db.message.findUnique({
    where: { clientId: `assign-announce:${id}` },
  })
  if (announce && !announce.deletedAt) {
    await db.message.update({
      where: { id: announce.id },
      data: { body: announceBody(title, dueAt) },
    })
    const serialized = await serializeMessage(announce.id)
    await notifySocket({
      rooms: [roomForGroup(assignment.subjectGroupId)],
      event: 'message:updated',
      data: serialized,
    })
  }

  await notifySocket({
    rooms: [roomForGroup(assignment.subjectGroupId)],
    event: 'assignments:update',
    data: { assignmentId: id, action: 'update' },
  })

  return NextResponse.json({ message: 'تکلیف به‌روزرسانی شد' })
}

/**
 * DELETE /api/assignments/[id] — حذف تکلیف (دو مرحله‌ای در صورت وجود پاسخ)
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'TEACHER') return jsonError('فقط معلم می‌تواند تکلیف را حذف کند', 403)

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const assignment = await getAssignmentById(id)
  if (!assignment) return jsonError('تکلیف یافت نشد', 404)
  const access = await getAssignmentAccess(session, assignment)
  if (!access) return jsonError('تکلیف یافت نشد یا دسترسی ندارید', 404)
  if (access !== 'MANAGE') return jsonError('فقط معلم می‌تواند تکلیف را حذف کند', 403)

  const submissions = await db.assignmentSubmission.count({ where: { assignmentId: id } })
  const confirm = req.nextUrl.searchParams.get('confirm') === 'true'
  if (submissions > 0 && !confirm) {
    return NextResponse.json(
      {
        error: 'این تکلیف پاسخ ثبت‌شده دارد و با حذف آن همه پاسخ‌ها و بازخوردها پاک می‌شوند',
        submissions,
      },
      { status: 409 },
    )
  }

  await db.assignment.delete({ where: { id } })

  // پیام خودکار تکلیف هم حذف (نرم) می‌شود تا پیام گمراه‌کننده در گروه نماند
  const announce = await db.message.findUnique({
    where: { clientId: `assign-announce:${id}` },
  })
  if (announce && !announce.deletedAt) {
    await db.message.update({
      where: { id: announce.id },
      data: {
        deletedAt: new Date(),
        body: '',
      },
    })
    await notifySocket({
      rooms: [roomForGroup(assignment.subjectGroupId)],
      event: 'message:deleted',
      data: { id: announce.id, kind: 'GROUP', subjectGroupId: assignment.subjectGroupId },
    })
  }

  await notifySocket({
    rooms: [roomForGroup(assignment.subjectGroupId)],
    event: 'assignments:update',
    data: { assignmentId: id, action: 'delete' },
  })

  return NextResponse.json({ message: 'تکلیف حذف شد' })
}
