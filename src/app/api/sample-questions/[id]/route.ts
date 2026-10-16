import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  sampleQEnabled,
  getSampleQuestionAccess,
  getSampleQuestionById,
  teacherCanUseClassroom,
  activeStudentsOfClassrooms,
  SAMPLEQ_STATUSES,
} from '@/lib/sampleq-access'
import { pushNotifications } from '@/lib/notifications'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

/** حذف فایل از دیسک — فقط کلید یکتای همین ردیف؛ هرگز فایل نمونه‌سؤال دیگر */
async function removeStoredFileQuietly(key: string) {
  await unlink(path.join(uploadDir(), path.basename(key))).catch(() => null)
}

/**
 * GET /api/sample-questions/[id] — جزئیات نمونه‌سؤال با کنترل دسترسی سمت سرور:
 * - معلم سازنده و مدیر مدرسه: همه جزئیات + مخاطبان (فهرست دانش‌آموزان هر کلاس)
 * - دانش‌آموز: فقط نمونه‌سؤال منتشرشده کلاس خودش؛ فایل پاسخ‌نامه فقط در صورت فعال‌بودن نمایش
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const { id } = await params
  const question = await getSampleQuestionById(id)
  if (!question) return jsonError('نمونه‌سؤال یافت نشد', 404)

  const access = await getSampleQuestionAccess(session, question)
  if (!access) return jsonError('نمونه‌سؤال یافت نشد یا دسترسی ندارید', 404)

  const files = await db.sampleQuestionFile.findMany({
    where: { questionId: id },
    orderBy: { createdAt: 'asc' },
  })

  const serializeFile = (f: { id: string; role: string; name: string; mime: string; size: number }) => ({
    id: f.id,
    role: f.role,
    name: f.name,
    mime: f.mime,
    size: f.size,
    url: `/api/sample-questions/${id}/files/${f.id}`,
  })

  // دانش‌آموز: فایل پاسخ‌نامه فقط در صورت فعال‌بودن نمایش
  const answerVisible = session.role !== 'STUDENT' || question.showAnswer

  let audiences: { id: string; name: string; studentCount: number; students: { id: string; fullName: string }[] }[] = []
  if (access === 'MANAGE' || session.role === 'SCHOOL_ADMIN') {
    const classIds = question.classes.map((c) => c.classroom.id)
    const enrollments = classIds.length
      ? await db.classroomEnrollment.findMany({
          where: { classroomId: { in: classIds }, student: { isActive: true } },
          select: { classroomId: true, student: { select: { id: true, fullName: true } } },
        })
      : []
    const byClass = new Map<string, { id: string; fullName: string }[]>()
    for (const e of enrollments) {
      if (!byClass.has(e.classroomId)) byClass.set(e.classroomId, [])
      byClass.get(e.classroomId)!.push({ id: e.student.id, fullName: e.student.fullName })
    }
    audiences = question.classes.map((c) => ({
      id: c.classroom.id,
      name: c.classroom.name,
      studentCount: (byClass.get(c.classroom.id) ?? []).length,
      students: (byClass.get(c.classroom.id) ?? []).sort((a, b) =>
        a.fullName.localeCompare(b.fullName, 'fa'),
      ),
    }))
  }

  let bookmarked = false
  if (session.role === 'STUDENT') {
    const bm = await db.sampleQuestionBookmark.findUnique({
      where: { questionId_userId: { questionId: id, userId: session.uid } },
      select: { id: true },
    })
    bookmarked = !!bm
  }

  return NextResponse.json({
    id: question.id,
    title: question.title,
    subject: question.subject,
    topic: question.topic,
    description: question.description,
    showAnswer: question.showAnswer,
    status: question.status,
    publishedAt: question.publishedAt?.toISOString() ?? null,
    createdAt: question.createdAt.toISOString(),
    teacherName: question.createdBy.fullName,
    canManage: access === 'MANAGE',
    canModerate: session.role === 'SCHOOL_ADMIN',
    classes: question.classes.map((c) => ({ id: c.classroom.id, name: c.classroom.name })),
    questionFiles: files.filter((f) => f.role === 'QUESTION').map(serializeFile),
    answerFiles: answerVisible
      ? files.filter((f) => f.role === 'ANSWER').map(serializeFile)
      : [],
    answerHidden: !answerVisible && files.some((f) => f.role === 'ANSWER'),
    audiences,
    bookmarked,
  })
}

const MAX_TITLE = 150
const MAX_SUBJECT = 60
const MAX_TOPIC = 60
const MAX_DESC = 4000
const MAX_FILES_PER_ROLE = 10

interface StagedFile {
  key: string
  name: string
  mime: string
  size: number
}

async function validateStagedFile(key: string, uploaderId: string): Promise<StagedFile | string> {
  if (!key || key.includes('..') || key.startsWith('/')) return 'فایل نامعتبر است'
  const meta = await db.upload.findUnique({ where: { key } }).catch(() => null)
  if (!meta) return 'فایل آپلودشده یافت نشد؛ دوباره تلاش کنید'
  if (meta.uploaderId !== uploaderId) return 'فایل نامعتبر است'
  return { key: meta.key, name: meta.name, mime: meta.mime, size: meta.size }
}

async function validateFileList(
  input: unknown,
  uploaderId: string,
  roleLabel: string,
): Promise<{ files: StagedFile[] } | { error: string }> {
  const arr = Array.isArray(input) ? input : []
  if (arr.length > MAX_FILES_PER_ROLE) {
    return { error: `حداکثر ${MAX_FILES_PER_ROLE} فایل برای ${roleLabel} مجاز است` }
  }
  const files: StagedFile[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    const key =
      typeof item === 'object' && item !== null ? String((item as { key?: unknown }).key ?? '') : ''
    if (!key) return { error: 'فایل نامعتبر است' }
    if (seen.has(key)) return { error: 'فایل تکراری است' }
    seen.add(key)
    const v = await validateStagedFile(key, uploaderId)
    if (typeof v === 'string') return { error: v }
    files.push(v)
  }
  return { files }
}

/**
 * PATCH /api/sample-questions/[id] — ویرایش نمونه‌سؤال:
 * - معلم سازنده: همه فیلدها، کلاس‌ها، فایل‌ها (جایگزینی امن)، نمایش پاسخ‌نامه و انتشار
 * - مدیر مدرسه: فقط «لغو انتشار» (حفظ محتوای آموزشی در کنترل مدرسه)
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const { id } = await params
  const question = await getSampleQuestionById(id)
  if (!question) return jsonError('نمونه‌سؤال یافت نشد', 404)
  const access = await getSampleQuestionAccess(session, question)
  if (!access) return jsonError('نمونه‌سؤال یافت نشد یا دسترسی ندارید', 404)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('درخواست نامعتبر است')
  const b = body as Record<string, unknown>

  // مدیر مدرسه: فقط لغو انتشار
  if (access === 'VIEW') {
    if (session.role === 'SCHOOL_ADMIN') {
      const keys = Object.keys(b)
      if (keys.length === 1 && b.status === 'UNPUBLISHED') {
        await db.sampleQuestion.update({ where: { id }, data: { status: 'UNPUBLISHED' } })
        return NextResponse.json({ message: 'انتشار نمونه‌سؤال لغو شد' })
      }
      return jsonError('مدیر مدرسه فقط می‌تواند انتشار را لغو کند', 403)
    }
    return jsonError('دسترسی غیرمجاز', 403)
  }

  // ── معلم سازنده ──
  const data: {
    title?: string
    subject?: string
    topic?: string | null
    description?: string
    showAnswer?: boolean
    status?: string
    publishedAt?: Date | null
  } = {}

  if ('title' in b) {
    const title = String(b.title ?? '').trim()
    if (!title) return jsonError('عنوان نمونه‌سؤال الزامی است')
    if (title.length > MAX_TITLE) return jsonError('عنوان بیش از حد بلند است')
    data.title = title
  }
  if ('subject' in b) {
    const subject = String(b.subject ?? '').trim()
    if (!subject) return jsonError('نام درس الزامی است')
    if (subject.length > MAX_SUBJECT) return jsonError('نام درس بیش از حد بلند است')
    data.subject = subject
  }
  if ('topic' in b) {
    const topic = String(b.topic ?? '').trim()
    if (topic.length > MAX_TOPIC) return jsonError('موضوع بیش از حد بلند است')
    data.topic = topic || null
  }
  if ('description' in b) {
    const description = String(b.description ?? '').trim()
    if (description.length > MAX_DESC) return jsonError('توضیحات بیش از حد بلند است')
    data.description = description
  }
  if ('showAnswer' in b) data.showAnswer = b.showAnswer === true
  if ('status' in b) {
    const status = String(b.status ?? '')
    if (!SAMPLEQ_STATUSES.includes(status as 'PUBLISHED')) {
      return jsonError('وضعیت انتشار نامعتبر است')
    }
    data.status = status
    if (status === 'PUBLISHED' && !question.publishedAt) data.publishedAt = new Date()
  }

  // کلاس‌های مخاطب — جایگزینی کامل با اعتبارسنجی انتساب معلم
  if ('classIds' in b) {
    const classIds = Array.isArray(b.classIds) ? [...new Set(b.classIds.map(String))] : []
    if (!classIds.length) return jsonError('حداقل یک کلاس برای دریافت نمونه‌سؤال انتخاب کنید')
    if (classIds.length > 20) return jsonError('حداکثر ۲۰ کلاس مجاز است')
    for (const cid of classIds) {
      const classroom = await db.classroom.findFirst({
        where: { id: cid },
        select: { id: true, schoolId: true },
      })
      if (!classroom || classroom.schoolId !== session.schoolId) {
        return jsonError('کلاس یافت نشد', 404)
      }
      const allowed = await teacherCanUseClassroom(session.uid, cid, session.schoolId)
      if (!allowed) return jsonError('شما به این کلاس اختصاص ندارید', 403)
    }
  }

  // فایل‌ها — نگه‌داشتنی‌ها با شناسه، جدیدها با کلید مرحله‌ای
  const keepQuestionIds: string[] = Array.isArray(b.keepQuestionFileIds)
    ? b.keepQuestionFileIds.map(String)
    : null!
  const keepAnswerIds: string[] = Array.isArray(b.keepAnswerFileIds)
    ? b.keepAnswerFileIds.map(String)
    : null!
  const replaceFiles =
    keepQuestionIds !== null ||
    keepAnswerIds !== null ||
    'questionFiles' in b ||
    'answerFiles' in b

  let newQuestionFiles: StagedFile[] = []
  let newAnswerFiles: StagedFile[] = []
  if ('questionFiles' in b) {
    const v = await validateFileList(b.questionFiles, session.uid, 'سؤال')
    if ('error' in v) return jsonError(v.error)
    newQuestionFiles = v.files
  }
  if ('answerFiles' in b) {
    const v = await validateFileList(b.answerFiles, session.uid, 'پاسخ‌نامه')
    if ('error' in v) return jsonError(v.error)
    newAnswerFiles = v.files
  }

  const currentFiles = await db.sampleQuestionFile.findMany({ where: { questionId: id } })
  let toDelete: typeof currentFiles = []
  let finalQuestionKeep: string[] = []
  let finalAnswerKeep: string[] = []

  if (replaceFiles) {
    const qKeep = keepQuestionIds ?? currentFiles.filter((f) => f.role === 'QUESTION').map((f) => f.id)
    const aKeep = keepAnswerIds ?? currentFiles.filter((f) => f.role === 'ANSWER').map((f) => f.id)
    const validIds = new Set(currentFiles.map((f) => f.id))
    for (const fid of [...qKeep, ...aKeep]) {
      if (!validIds.has(fid)) return jsonError('فایل یافت نشد', 404)
    }
    // هر شناسه فقط در نقش خودش معتبر است
    for (const fid of qKeep) {
      const f = currentFiles.find((x) => x.id === fid)
      if (f && f.role !== 'QUESTION') return jsonError('فایل نامعتبر است')
    }
    for (const fid of aKeep) {
      const f = currentFiles.find((x) => x.id === fid)
      if (f && f.role !== 'ANSWER') return jsonError('فایل نامعتبر است')
    }
    finalQuestionKeep = qKeep
    finalAnswerKeep = aKeep
    toDelete = currentFiles.filter(
      (f) =>
        (f.role === 'QUESTION' && !qKeep.includes(f.id)) ||
        (f.role === 'ANSWER' && !aKeep.includes(f.id)),
    )
  }

  // اعمال تغییرات
  await db.$transaction(async (tx) => {
    if (Object.keys(data).length) {
      await tx.sampleQuestion.update({ where: { id }, data })
    }
    if ('classIds' in b) {
      const classIds = [...new Set((b.classIds as unknown[]).map(String))]
      await tx.sampleQuestionClass.deleteMany({ where: { questionId: id } })
      await tx.sampleQuestionClass.createMany({
        data: classIds.map((classroomId) => ({ questionId: id, classroomId })),
      })
    }
    if (replaceFiles) {
      if (toDelete.length) {
        await tx.sampleQuestionFile.deleteMany({
          where: { id: { in: toDelete.map((f) => f.id) } },
        })
      }
      if (newQuestionFiles.length || newAnswerFiles.length) {
        await tx.sampleQuestionFile.createMany({
          data: [
            ...newQuestionFiles.map((f) => ({ questionId: id, role: 'QUESTION', ...f })),
            ...newAnswerFiles.map((f) => ({ questionId: id, role: 'ANSWER', ...f })),
          ],
        })
      }
    }
  })

  // ردیف‌های Upload جدید به‌عنوان کتابخانه رسانه پلتفرم باقی می‌مانند (گالری مدیر کل)
  // فایل‌های حذف‌شده از دیسک — فقط کلید یکتای همین نمونه‌سؤال
  for (const f of toDelete) {
    await removeStoredFileQuietly(f.key)
  }

  // انتشار: اعلان برای دانش‌آموزان کلاس‌های مخاطب فعلی (ضدتکرار دائمی با dedupeKey)
  const finalStatus = data.status ?? question.status
  const classIdsFinal = 'classIds' in b
    ? [...new Set((b.classIds as unknown[]).map(String))]
    : question.classes.map((c) => c.classroom.id)
  if (finalStatus === 'PUBLISHED') {
    const students = await activeStudentsOfClassrooms(classIdsFinal)
    await pushNotifications(
      students.map((s) => ({
        userId: s.id,
        type: 'SAMPLEQ_NEW',
        title: `نمونه‌سؤال جدید: ${data.title ?? question.title}`,
        body: `درس ${data.subject ?? question.subject}${
          (data.topic ?? question.topic) ? ` — موضوع: ${data.topic ?? question.topic}` : ''
        } — ${session.fullName}`,
        link: `/sample-questions/${id}`,
        dedupeKey: `sampleq:${id}`,
      })),
    )
  }

  // پیام گروهی (فقط در صورت درخواست صریح در همین ویرایش)
  const sendToGroup =
    b.sendToGroup && typeof b.sendToGroup === 'object'
      ? (b.sendToGroup as { groupId?: unknown })
      : null
  if (sendToGroup?.groupId && finalStatus === 'PUBLISHED') {
    const groupId = String(sendToGroup.groupId)
    const group = await db.subjectGroup.findUnique({
      where: { id: groupId },
      include: { classroom: { select: { id: true, schoolId: true } } },
    })
    if (!group || !group.classroom) return NextResponse.json({ warning: 'گروه درسی یافت نشد' })
    if (!classIdsFinal.includes(group.classroom.id)) {
      return NextResponse.json({ warning: 'گروه باید از کلاس‌های مخاطب باشد' })
    }
    const assigned = await db.teachingAssignment.findFirst({
      where: { teacherId: session.uid, subjectGroupId: groupId },
      select: { id: true },
    })
    if (!assigned) return NextResponse.json({ warning: 'به این گروه اختصاص ندارید' })
    if (group.archivedAt) return NextResponse.json({ warning: 'این گروه بایگانی شده است' })

    const clientId = `sampleq-announce:${id}:${groupId}`
    const existing = await db.message.findUnique({ where: { clientId }, select: { id: true } })
    if (!existing) {
      const { serializeMessage } = await import('@/lib/messaging')
      const { notifySocket, roomForGroup } = await import('@/lib/notify')
      const topicText = (data.topic ?? question.topic) ? `\nموضوع: ${data.topic ?? question.topic}` : ''
      const msg = await db.message.create({
        data: {
          kind: 'GROUP',
          subjectGroupId: groupId,
          senderId: session.uid,
          type: 'SAMPLEQ',
          body: `نمونه‌سؤال «${data.title ?? question.title}» برای درس ${
            data.subject ?? question.subject
          } منتشر شد.${topicText}`,
          sampleQuestionId: id,
          clientId,
        },
      })
      const serialized = await serializeMessage(msg.id)
      await notifySocket({
        rooms: [roomForGroup(groupId)],
        event: 'message:new',
        data: serialized,
      })
    }
  }

  return NextResponse.json({ message: 'نمونه‌سؤال به‌روزرسانی شد' })
}

/**
 * DELETE /api/sample-questions/[id] — حذف نمونه‌سؤال (سازنده یا مدیر مدرسه).
 * فایل‌های همین نمونه‌سؤال از دیسک حذف می‌شوند؛ فایل نمونه‌سؤال دیگر هرگز دست نمی‌خورد.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const { id } = await params
  const question = await getSampleQuestionById(id)
  if (!question) return jsonError('نمونه‌سؤال یافت نشد', 404)
  const access = await getSampleQuestionAccess(session, question)
  // حذف فقط توسط معلم سازنده (MANAGE) یا مدیر همان مدرسه (VIEW) —
  // مدیر مدرسه دیگر حتی با دانستن شناسه → 404
  if (access !== 'MANAGE' && !(session.role === 'SCHOOL_ADMIN' && access === 'VIEW')) {
    return jsonError('نمونه‌سؤال یافت نشد یا دسترسی ندارید', 404)
  }

  const files = await db.sampleQuestionFile.findMany({ where: { questionId: id } })
  await db.sampleQuestion.delete({ where: { id } })
  for (const f of files) {
    await removeStoredFileQuietly(f.key)
  }

  return NextResponse.json({ message: 'نمونه‌سؤال حذف شد' })
}
