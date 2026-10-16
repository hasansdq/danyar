import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  assignmentsEnabled,
  getAssignmentAccess,
  getAssignmentById,
  serializeSubmission,
} from '@/lib/assignment-access'
import { notifySocket, roomForGroup } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

const MAX_TEXT = 8000

/**
 * PUT /api/assignments/[id]/submission — ثبت یا ویرایش پاسخ دانش‌آموز
 * قوانین سمت سرور:
 * - فقط دانش‌آموز عضو مؤثر گروه و مدرسه با امکانات فعال
 * - گروه بایگانی‌شده → ممنوع
 * - رعایت نحوه ارسال (TEXT / FILE / BOTH)
 * - ویرایش فقط در صورت allowEdit و بررسی‌نشده بودن پاسخ
 * - submittedAt اولین ارسال ثابت می‌ماند (پاسخ دیرهنگام دیرهنگام می‌ماند)
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'STUDENT') {
    return jsonError('فقط دانش‌آموز می‌تواند پاسخ ارسال کند', 403)
  }

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const assignment = await getAssignmentById(id)
  if (!assignment) return jsonError('تکلیف یافت نشد', 404)

  const access = await getAssignmentAccess(session, assignment)
  if (!access) return jsonError('تکلیف یافت نشد یا دسترسی ندارید', 404)
  if (assignment.subjectGroup.archivedAt) {
    return jsonError('گروه این تکلیف بایگانی شده است و امکان ارسال پاسخ نیست', 403)
  }

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const text = String(body.text ?? '').trim()
  const attachmentKey = body.attachment?.key ? String(body.attachment.key) : null
  const hasAtt = !!attachmentKey

  // رعایت نحوه ارسال پاسخ
  const mode = assignment.answerMode
  if (mode === 'TEXT') {
    if (!text) return jsonError('ارسال متن پاسخ برای این تکلیف الزامی است')
    if (hasAtt) return jsonError('این تکلیف فقط پاسخ متنی می‌پذیرد', 400)
  } else if (mode === 'FILE') {
    if (!hasAtt) return jsonError('ارسال فایل پاسخ برای این تکلیف الزامی است')
    if (text) return jsonError('این تکلیف فقط پاسخ فایلی می‌پذیرد؛ متن مجاز نیست', 400)
  } else {
    if (!text && !hasAtt) return jsonError('متن یا فایل پاسخ را ارسال کنید')
  }
  if (text.length > MAX_TEXT) return jsonError('متن پاسخ بیش از حد بلند است')

  // اعتبارسنجی فایل مرحله‌ای
  let att: { key: string; name: string; mime: string; size: number } | null = null
  if (attachmentKey) {
    if (attachmentKey.includes('..') || attachmentKey.startsWith('/')) {
      return jsonError('پیوست نامعتبر است')
    }
    const meta = await db.upload.findUnique({ where: { key: attachmentKey } }).catch(() => null)
    if (!meta) return jsonError('فایل آپلودشده یافت نشد؛ دوباره تلاش کنید', 400)
    if (meta.uploaderId !== session.uid) return jsonError('پیوست نامعتبر است', 400)
    att = { key: meta.key, name: meta.name, mime: meta.mime, size: meta.size }
  }

  const existing = await db.assignmentSubmission.findUnique({
    where: { assignmentId_studentId: { assignmentId: id, studentId: session.uid } },
    include: { student: { select: { fullName: true } } },
  })

  if (existing) {
    // قوانین ویرایش
    if (existing.reviewedAt) {
      return jsonError('پاسخ شما بررسی شده و قابل تغییر نیست', 403)
    }
    if (!assignment.allowEdit) {
      return jsonError('امکان اصلاح پاسخ برای این تکلیف وجود ندارد', 403)
    }
  }

  if (existing) {
    const updated = await db.assignmentSubmission.update({
      where: { id: existing.id },
      data: {
        text,
        fileName: att?.name ?? null,
        fileKey: att?.key ?? null,
        fileMime: att?.mime ?? null,
        fileSize: att?.size ?? null,
        editedAt: new Date(),
      },
      include: { student: { select: { fullName: true } } },
    })
    // ردیف Upload به‌عنوان کتابخانه رسانه پلتفرم باقی می‌ماند (گالری مدیر کل + شمارش دانلود)
    await notifySocket({
      rooms: [roomForGroup(assignment.subjectGroupId)],
      event: 'assignments:update',
      data: { assignmentId: id, action: 'submit' },
    })
    return NextResponse.json({
      submission: serializeSubmission(updated, assignment.dueAt),
    })
  }

  const created = await db.assignmentSubmission.create({
    data: {
      assignmentId: id,
      studentId: session.uid,
      text,
      fileName: att?.name,
      fileKey: att?.key,
      fileMime: att?.mime,
      fileSize: att?.size,
    },
    include: { student: { select: { fullName: true } } },
  })

  // ردیف Upload به‌عنوان کتابخانه رسانه پلتفرم باقی می‌ماند (گالری مدیر کل + شمارش دانلود)

  await notifySocket({
    rooms: [roomForGroup(assignment.subjectGroupId)],
    event: 'assignments:update',
    data: { assignmentId: id, action: 'submit' },
  })

  return NextResponse.json(
    { submission: serializeSubmission(created, assignment.dueAt) },
    { status: 201 },
  )
}
