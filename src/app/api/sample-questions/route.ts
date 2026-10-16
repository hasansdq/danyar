import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { getSchoolFeatures } from '@/lib/chat-access'
import { serializeMessage } from '@/lib/messaging'
import {
  sampleQEnabled,
  teacherCanUseClassroom,
  activeStudentsOfClassrooms,
  SAMPLEQ_STATUSES,
} from '@/lib/sampleq-access'
import { pushNotifications } from '@/lib/notifications'
import { notifySocket, roomForGroup } from '@/lib/notify'

/**
 * GET /api/sample-questions — فهرست نمونه‌سؤالات متناسب با نقش با صفحه‌بندی:
 * - معلم: نمونه‌سؤالات خودش
 * - دانش‌آموز: نمونه‌سؤالات منتشرشده کلاس‌های خودش + وضعیت نشان‌گذاری
 * - مدیر مدرسه: همه نمونه‌سؤالات مدرسه
 * فیلترها: ?q= ?subject= ?classId= ?teacherId= ?status= ?bookmarked=1 &page= &pageSize=
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const subject = (sp.get('subject') ?? '').trim()
  const classId = (sp.get('classId') ?? '').trim()
  const teacherId = (sp.get('teacherId') ?? '').trim()
  const status = (sp.get('status') ?? '').trim()
  const bookmarkedOnly = sp.get('bookmarked') === '1'
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const pageSize = Math.min(Math.max(Number(sp.get('pageSize') ?? 20) || 20, 5), 50)

  // محدوده نقش‌محور
  let baseWhere: Record<string, unknown>
  if (session.role === 'TEACHER') {
    baseWhere = { schoolId: session.schoolId, createdById: session.uid }
  } else if (session.role === 'STUDENT') {
    baseWhere = {
      schoolId: session.schoolId,
      status: 'PUBLISHED',
      classes: {
        some: {
          classroom: {
            schoolId: session.schoolId,
            enrollments: { some: { studentId: session.uid } },
          },
        },
      },
    }
  } else {
    baseWhere = { schoolId: session.schoolId }
  }

  const where: Record<string, unknown> = { ...baseWhere }
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { subject: { contains: q } },
      { topic: { contains: q } },
    ]
  }
  if (subject) where.subject = subject
  if (classId) where.classes = { some: { classroomId: classId } }
  if (teacherId) where.createdById = teacherId
  if (status && SAMPLEQ_STATUSES.includes(status as 'PUBLISHED')) {
    where.status = status
  }
  if (bookmarkedOnly && session.role === 'STUDENT') {
    where.bookmarks = { some: { userId: session.uid } }
  }

  const [rows, total] = await Promise.all([
    db.sampleQuestion.findMany({
      where,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        createdBy: { select: { fullName: true } },
        classes: {
          include: { classroom: { select: { id: true, name: true } } },
        },
        files: { select: { role: true } },
      },
    }),
    db.sampleQuestion.count({ where }),
  ])

  const ids = rows.map((r) => r.id)

  // نشان‌گذاری‌های دانش‌آموز
  let myBookmarks = new Set<string>()
  if (session.role === 'STUDENT' && ids.length) {
    const bm = await db.sampleQuestionBookmark.findMany({
      where: { userId: session.uid, questionId: { in: ids } },
      select: { questionId: true },
    })
    myBookmarks = new Set(bm.map((b) => b.questionId))
  }

  // درس‌های متمایز در محدوده نقش (برای فیلتر درس بدون وابستگی به صفحه‌بندی)
  const subjectRows = await db.sampleQuestion.findMany({
    where: baseWhere,
    select: { subject: true },
    distinct: ['subject'],
    orderBy: { subject: 'asc' },
  })

  // فهرست معلمان برای فیلتر مدیر
  let teachers: { id: string; fullName: string }[] = []
  if (session.role === 'SCHOOL_ADMIN') {
    const tRows = await db.user.findMany({
      where: {
        schoolId: session.schoolId,
        role: 'TEACHER',
        isActive: true,
        sampleqCreated: { some: {} },
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    })
    teachers = tRows
  }

  return NextResponse.json({
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    subjects: subjectRows.map((s) => s.subject),
    teachers,
    questions: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subject: r.subject,
      topic: r.topic,
      description: r.description,
      showAnswer: r.showAnswer,
      status: r.status,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      teacherName: r.createdBy.fullName,
      canManage: r.createdById === session.uid,
      classes: r.classes.map((c) => ({ id: c.classroom.id, name: c.classroom.name })),
      questionFileCount: r.files.filter((f) => f.role === 'QUESTION').length,
      answerFileCount: r.files.filter((f) => f.role === 'ANSWER').length,
      bookmarked: myBookmarks.has(r.id),
    })),
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

/** اعتبارسنجی فایل مرحله‌ای (آپلودشده با /api/uploads) — مالکیت با آپلودکننده */
async function validateStagedFile(
  key: string,
  uploaderId: string,
): Promise<StagedFile | string> {
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
    const key = typeof item === 'object' && item !== null ? String((item as { key?: unknown }).key ?? '') : ''
    if (!key) return { error: 'فایل نامعتبر است' }
    if (seen.has(key)) return { error: 'فایل تکراری است' }
    seen.add(key)
    const v = await validateStagedFile(key, uploaderId)
    if (typeof v === 'string') return { error: v }
    files.push(v)
  }
  return { files }
}

/** پیام خودکار انتشار در گروه درسی انتخابی (ضدتکرار با clientId قطعی) */
async function announceToGroup(
  questionId: string,
  groupId: string,
  payload: { title: string; subject: string; topic: string | null },
  senderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const group = await db.subjectGroup.findUnique({
    where: { id: groupId },
    include: { classroom: { select: { id: true, name: true, schoolId: true } } },
  })
  if (!group || !group.classroom) return { ok: false, error: 'گروه درسی یافت نشد' }

  const features = await getSchoolFeatures(group.classroom.schoolId)
  if (!features.chat) return { ok: false, error: 'پیام‌رسانی گروهی برای این مدرسه غیرفعال است' }

  // گروه باید متعلق به یکی از کلاس‌های مخاطب نمونه‌سؤال باشد
  const inClass = await db.sampleQuestionClass.findFirst({
    where: { questionId, classroomId: group.classroom.id },
    select: { id: true },
  })
  if (!inClass) {
    return { ok: false, error: 'گروه انتخابی باید از کلاس‌های مخاطب نمونه‌سؤال باشد' }
  }
  if (group.archivedAt) return { ok: false, error: 'این گروه بایگانی شده است' }

  const assigned = await db.teachingAssignment.findFirst({
    where: { teacherId: senderId, subjectGroupId: groupId },
    select: { id: true },
  })
  if (!assigned) return { ok: false, error: 'شما به این گروه درسی اختصاص ندارید' }

  // ضدتکرار قطعی: همان نمونه‌سؤال هرگز دوبار در یک گروه پیام نمی‌شود
  const clientId = `sampleq-announce:${questionId}:${groupId}`
  const existing = await db.message.findUnique({ where: { clientId }, select: { id: true } })
  if (existing) return { ok: true }

  const topicText = payload.topic ? `\nموضوع: ${payload.topic}` : ''
  const msg = await db.message.create({
    data: {
      kind: 'GROUP',
      subjectGroupId: groupId,
      senderId,
      type: 'SAMPLEQ',
      body: `نمونه‌سؤال «${payload.title}» برای درس ${payload.subject} منتشر شد.${topicText}`,
      sampleQuestionId: questionId,
      clientId,
    },
  })
  const serialized = await serializeMessage(msg.id)
  await notifySocket({
    rooms: [roomForGroup(groupId)],
    event: 'message:new',
    data: serialized,
  })
  return { ok: true }
}

/**
 * POST /api/sample-questions — ایجاد نمونه‌سؤال (فقط معلم)
 * نمونه‌سؤال متعلق به کلاس‌های انتخاب‌شده است؛ در صورت انتشار، اعلان خصوصی
 * برای دانش‌آموزان کلاس‌ها (ضدتکرار) و در صورت درخواست، پیام خودکار در گروه
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role !== 'TEACHER') {
    return jsonError('فقط معلم می‌تواند نمونه‌سؤال ایجاد کند', 403)
  }
  const enabled = await sampleQEnabled(session.schoolId)
  if (!enabled) return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('درخواست نامعتبر است')
  const b = body as Record<string, unknown>

  // ضدتکرار تلاش مجدد: با clientId یکتا، همان درخواست همیشه همان نمونه‌سؤال را برمی‌گرداند
  const clientId = b.clientId ? String(b.clientId).slice(0, 64) : null
  if (clientId) {
    const existing = await db.sampleQuestion.findUnique({ where: { clientId } })
    if (existing) {
      return NextResponse.json({ id: existing.id, duplicate: true }, { status: 200 })
    }
  }

  const title = String(b.title ?? '').trim()
  const subject = String(b.subject ?? '').trim()
  const topic = String(b.topic ?? '').trim()
  const description = String(b.description ?? '').trim()
  const showAnswer = b.showAnswer === true
  const status = String(b.status ?? 'PUBLISHED')
  const classIds = Array.isArray(b.classIds) ? [...new Set(b.classIds.map(String))] : []

  if (!title) return jsonError('عنوان نمونه‌سؤال الزامی است')
  if (title.length > MAX_TITLE) return jsonError('عنوان بیش از حد بلند است')
  if (!subject) return jsonError('نام درس الزامی است')
  if (subject.length > MAX_SUBJECT) return jsonError('نام درس بیش از حد بلند است')
  if (topic.length > MAX_TOPIC) return jsonError('موضوع بیش از حد بلند است')
  if (description.length > MAX_DESC) return jsonError('توضیحات بیش از حد بلند است')
  if (!SAMPLEQ_STATUSES.includes(status as 'PUBLISHED')) {
    return jsonError('وضعیت انتشار نامعتبر است')
  }
  if (!classIds.length) return jsonError('حداقل یک کلاس برای دریافت نمونه‌سؤال انتخاب کنید')
  if (classIds.length > 20) return jsonError('حداکثر ۲۰ کلاس مجاز است')

  // معلم باید واقعاً به همه کلاس‌ها اختصاص داشته باشد (کلاس مدرسه دیگر → 404)
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

  const qFiles = await validateFileList(b.questionFiles, session.uid, 'سؤال')
  if ('error' in qFiles) return jsonError(qFiles.error)
  const aFiles = await validateFileList(b.answerFiles, session.uid, 'پاسخ‌نامه')
  if ('error' in aFiles) return jsonError(aFiles.error)

  const sendToGroup =
    b.sendToGroup && typeof b.sendToGroup === 'object'
      ? (b.sendToGroup as { groupId?: unknown })
      : null
  const groupId = sendToGroup?.groupId ? String(sendToGroup.groupId) : null

  const created = await db.sampleQuestion.create({
    data: {
      schoolId: session.schoolId,
      title,
      subject,
      topic: topic || null,
      description,
      showAnswer,
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      createdById: session.uid,
      clientId,
      classes: {
        create: classIds.map((classroomId) => ({ classroomId })),
      },
      files: {
        create: [
          ...qFiles.files.map((f) => ({ role: 'QUESTION', ...f })),
          ...aFiles.files.map((f) => ({ role: 'ANSWER', ...f })),
        ],
      },
    },
  })

  // ردیف‌های Upload به‌عنوان کتابخانه رسانه پلتفرم باقی می‌مانند (گالری مدیر کل + شمارش دانلود)

  if (status === 'PUBLISHED') {
    // اعلان انتشار برای دانش‌آموزان فعال کلاس‌های مخاطب — هر کاربر فقط یک‌بار
    const students = await activeStudentsOfClassrooms(classIds)
    await pushNotifications(
      students.map((s) => ({
        userId: s.id,
        type: 'SAMPLEQ_NEW',
        title: `نمونه‌سؤال جدید: ${title}`,
        body: `درس ${subject}${topic ? ` — موضوع: ${topic}` : ''} — ${session.fullName}`,
        link: `/sample-questions/${created.id}`,
        dedupeKey: `sampleq:${created.id}`,
      })),
    )

    if (groupId) {
      const r = await announceToGroup(created.id, groupId, { title, subject, topic: topic || null }, session.uid)
      if (!r.ok) {
        // نمونه‌سؤال ساخته شد اما پیام گروهی نامعتبر است — خطای شفاف برمی‌گردد
        return NextResponse.json(
          { id: created.id, warning: r.error, message: 'نمونه‌سؤال ایجاد شد اما ارسال پیام گروهی انجام نشد' },
          { status: 201 },
        )
      }
    }
  }

  return NextResponse.json(
    { id: created.id, message: 'نمونه‌سؤال ایجاد شد' },
    { status: 201 },
  )
}
