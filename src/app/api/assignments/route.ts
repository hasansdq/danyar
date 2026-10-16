import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { getSchoolFeatures } from '@/lib/chat-access'
import { serializeMessage } from '@/lib/messaging'
import {
  assignmentsEnabled,
  effectiveGroupStudents,
  statsFromStatuses,
} from '@/lib/assignment-access'
import { computeSubmissionStatus } from '@/lib/assignment-status'
import { pushNotifications } from '@/lib/notifications'
import { notifySocket, roomForGroup } from '@/lib/notify'

/**
 * GET /api/assignments — فهرست تکالیف متناسب با نقش:
 * - معلم: تکالیف گروه‌های خودش + آمار پیگیری
 * - دانش‌آموز: تکالیف گروه‌های خودش + وضعیت پاسخ خودش
 * - مدیر مدرسه: همه تکالیف مدرسه (فقط‌خواندنی)
 * فیلترها: ?groupId= و ?q=
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const sp = req.nextUrl.searchParams
  const groupFilter = sp.get('groupId') ?? ''
  const q = (sp.get('q') ?? '').trim()

  // تعیین گروه‌های قابل دسترس بر اساس نقش
  let groupIds: string[]
  let groupsMeta: { id: string; name: string; classroomId: string; classroomName: string }[]
  if (session.role === 'TEACHER') {
    const rows = await db.teachingAssignment.findMany({
      where: { teacherId: session.uid },
      select: {
        subjectGroup: {
          select: {
            id: true,
            name: true,
            classroom: { select: { id: true, name: true } },
          },
        },
      },
    })
    const seen = new Map<
      string,
      { id: string; name: string; classroomId: string; classroomName: string }
    >()
    for (const r of rows) {
      const c = r.subjectGroup.classroom
      if (!c) continue
      if (!seen.has(r.subjectGroup.id)) {
        seen.set(r.subjectGroup.id, {
          id: r.subjectGroup.id,
          name: r.subjectGroup.name,
          classroomId: c.id,
          classroomName: c.name,
        })
      }
    }
    groupsMeta = [...seen.values()]
    groupIds = groupsMeta.map((g) => g.id)
  } else if (session.role === 'STUDENT') {
    const groups = await db.subjectGroup.findMany({
      where: {
        classroom: {
          schoolId: session.schoolId,
          enrollments: { some: { studentId: session.uid } },
        },
      },
      select: {
        id: true,
        name: true,
        classroom: { select: { id: true, name: true } },
      },
    })
    const added = await db.groupMemberOverride.findMany({
      where: { userId: session.uid, action: 'ADD' },
      select: {
        subjectGroup: {
          select: {
            id: true,
            name: true,
            classroom: { select: { id: true, name: true } },
          },
        },
      },
    })
    const removed = new Set(
      (
        await db.groupMemberOverride.findMany({
          where: { userId: session.uid, action: 'REMOVE' },
          select: { subjectGroupId: true },
        })
      ).map((r) => r.subjectGroupId),
    )
    const seen = new Map<
      string,
      { id: string; name: string; classroomId: string; classroomName: string }
    >()
    for (const g of [...groups, ...added.map((a) => a.subjectGroup)]) {
      if (!g.classroom) continue
      if (!removed.has(g.id) && !seen.has(g.id)) {
        seen.set(g.id, {
          id: g.id,
          name: g.name,
          classroomId: g.classroom.id,
          classroomName: g.classroom.name,
        })
      }
    }
    groupsMeta = [...seen.values()]
    groupIds = groupsMeta.map((g) => g.id)
  } else {
    // مدیر مدرسه: همه گروه‌های مدرسه
    const groups = await db.subjectGroup.findMany({
      where: { classroom: { schoolId: session.schoolId } },
      select: {
        id: true,
        name: true,
        classroom: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    })
    groupsMeta = groups
      .filter((g) => g.classroom)
      .map((g) => ({
        id: g.id,
        name: g.name,
        classroomId: g.classroom!.id,
        classroomName: g.classroom!.name,
      }))
    groupIds = groupsMeta.map((g) => g.id)
  }

  if (groupFilter) groupIds = groupIds.filter((id) => id === groupFilter)
  if (!groupIds.length) {
    return NextResponse.json({ assignments: [], groups: groupsMeta })
  }

  const assignments = await db.assignment.findMany({
    where: {
      subjectGroupId: { in: groupIds },
      ...(q ? { title: { contains: q } } : {}),
    },
    include: {
      subjectGroup: { select: { name: true, classroom: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  const ids = assignments.map((a) => a.id)

  // شناسه گروه → شناسه کلاس (برای شمارش دانش‌آموزان مؤثر)
  const groupRows = await db.subjectGroup.findMany({
    where: { id: { in: [...new Set(assignments.map((a) => a.subjectGroupId))] } },
    select: { id: true, classroomId: true },
  })
  const groupIdToClassroom = new Map(groupRows.map((g) => [g.id, g.classroomId]))

  let statsByAssignment = new Map<string, ReturnType<typeof statsFromStatuses>>()
  let mySubmissions = new Map<
    string,
    {
      id: string
      assignmentId: string
      submittedAt: Date
      reviewedAt: Date | null
      feedbackStatus: string
      grade: number | null
    }
  >()

  if (session.role !== 'STUDENT') {
    // آمار پیگیری: تعداد دانش‌آموزان مؤثر + وضعیت پاسخ‌ها
    const classroomIds = [
      ...new Set(groupRows.map((g) => g.classroomId).filter((c): c is string => !!c)),
    ]
    const enrollments = await db.classroomEnrollment.findMany({
      where: { classroomId: { in: classroomIds } },
      select: { classroomId: true, studentId: true },
    })
    const overrides = await db.groupMemberOverride.findMany({
      where: { subjectGroupId: { in: [...groupIdToClassroom.keys()] } },
      select: { subjectGroupId: true, userId: true, action: true },
    })

    // دانش‌آموزان مؤثر هر گروه (ثبت‌نام کلاس + استثناها)
    const studentsByGroup = new Map<string, Set<string>>()
    for (const g of groupRows) {
      const cid = g.classroomId
      studentsByGroup.set(
        g.id,
        new Set(
          enrollments.filter((e) => e.classroomId === cid).map((e) => e.studentId),
        ),
      )
    }
    for (const o of overrides) {
      const set = studentsByGroup.get(o.subjectGroupId)
      if (!set) continue
      if (o.action === 'REMOVE') set.delete(o.userId)
      if (o.action === 'ADD') set.add(o.userId)
    }

    const subs = ids.length
      ? await db.assignmentSubmission.findMany({
          where: { assignmentId: { in: ids } },
          select: {
            assignmentId: true,
            studentId: true,
            submittedAt: true,
            reviewedAt: true,
            feedbackStatus: true,
          },
        })
      : []
    const subsByAssignment = new Map<string, typeof subs>()
    for (const s of subs) {
      if (!subsByAssignment.has(s.assignmentId)) subsByAssignment.set(s.assignmentId, [])
      subsByAssignment.get(s.assignmentId)!.push(s)
    }

    for (const a of assignments) {
      const studentIds = studentsByGroup.get(a.subjectGroupId) ?? new Set<string>()
      const rows = (subsByAssignment.get(a.id) ?? [])
        .filter((s) => studentIds.has(s.studentId))
        .map((s) => ({
          status: computeSubmissionStatus(
            {
              submittedAt: s.submittedAt.toISOString(),
              reviewedAt: s.reviewedAt?.toISOString() ?? null,
            },
            a.dueAt?.toISOString() ?? null,
          ),
          feedbackStatus: s.feedbackStatus,
        }))
      const st = statsFromStatuses(rows)
      // دانش‌آموزان بدون پاسخ رکورد ندارند؛ کل از روی عضویت مؤثر شمرده می‌شود
      st.total = studentIds.size
      st.notSubmitted = Math.max(0, studentIds.size - st.submitted)
      statsByAssignment.set(a.id, st)
    }
  } else {
    const subs = ids.length
      ? await db.assignmentSubmission.findMany({
          where: { assignmentId: { in: ids }, studentId: session.uid },
          select: {
            id: true,
            assignmentId: true,
            submittedAt: true,
            reviewedAt: true,
            feedbackStatus: true,
            grade: true,
          },
        })
      : []
    mySubmissions = new Map(subs.map((s) => [s.assignmentId, s]))
  }

  return NextResponse.json({
    groups: groupsMeta,
    assignments: assignments.map((a) => {
      if (session.role !== 'STUDENT') {
        return {
          id: a.id,
          title: a.title,
          description: a.description,
          subjectGroupId: a.subjectGroupId,
          groupName: a.subjectGroup.name,
          classroomName: a.subjectGroup.classroom?.name ?? '',
          answerMode: a.answerMode,
          allowEdit: a.allowEdit,
          maxGrade: a.maxGrade,
          dueAt: a.dueAt?.toISOString() ?? null,
          hasAttachment: !!a.attachmentKey,
          createdAt: a.createdAt.toISOString(),
          stats:
            statsByAssignment.get(a.id) ??
            statsFromStatuses([]),
        }
      }
      const s = mySubmissions.get(a.id) ?? null
      return {
        id: a.id,
        title: a.title,
        description: a.description,
        subjectGroupId: a.subjectGroupId,
        groupName: a.subjectGroup.name,
        classroomName: a.subjectGroup.classroom?.name ?? '',
        answerMode: a.answerMode,
        allowEdit: a.allowEdit,
        maxGrade: a.maxGrade,
        dueAt: a.dueAt?.toISOString() ?? null,
        hasAttachment: !!a.attachmentKey,
        createdAt: a.createdAt.toISOString(),
        myStatus: computeSubmissionStatus(
          s
            ? {
                submittedAt: s.submittedAt.toISOString(),
                reviewedAt: s.reviewedAt?.toISOString() ?? null,
              }
            : null,
          a.dueAt?.toISOString() ?? null,
        ),
        myFeedbackStatus: s?.feedbackStatus ?? null,
        myGrade: s?.grade ?? null,
      }
    }),
  })
}

const MAX_TITLE = 120
const MAX_DESC = 4000

/** اعتبارسنجی پیوست مرحله‌ای (آپلودشده با /api/uploads) */
async function validateStagedAttachment(
  key: string,
  uploaderId: string,
): Promise<{ key: string; name: string; mime: string; size: number } | string> {
  if (key.includes('..') || key.startsWith('/')) return 'پیوست نامعتبر است'
  const meta = await db.upload.findUnique({ where: { key } }).catch(() => null)
  if (!meta) return 'فایل آپلودشده یافت نشد؛ دوباره تلاش کنید'
  if (meta.uploaderId !== uploaderId) return 'پیوست نامعتبر است'
  return { key: meta.key, name: meta.name, mime: meta.mime, size: meta.size }
}

/**
 * POST /api/assignments — ایجاد تکلیف (فقط معلم منتسب به گروه؛ تکلیف همیشه به یک گروه درسی متصل است)
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role !== 'TEACHER') {
    return jsonError('فقط معلم می‌تواند تکلیف ایجاد کند', 403)
  }

  const enabled = await assignmentsEnabled(session.schoolId)
  if (!enabled) return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const subjectGroupId = String(body.subjectGroupId ?? '')
  const title = String(body.title ?? '').trim()
  const description = String(body.description ?? '').trim()
  const answerMode = String(body.answerMode ?? 'BOTH')
  const allowEdit = body.allowEdit === true
  const maxGrade =
    body.maxGrade === null || body.maxGrade === undefined || body.maxGrade === ''
      ? null
      : Number(body.maxGrade)
  const dueAtRaw = body.dueAt ? String(body.dueAt) : null
  const attachmentKey = body.attachment?.key ? String(body.attachment.key) : null

  if (!subjectGroupId) return jsonError('گروه درسی تکلیف باید مشخص باشد')
  if (!title) return jsonError('عنوان تکلیف الزامی است')
  if (title.length > MAX_TITLE) return jsonError('عنوان تکلیف بیش از حد بلند است')
  if (description.length > MAX_DESC)
    return jsonError('توضیحات بیش از حد بلند است')
  if (!['TEXT', 'FILE', 'BOTH'].includes(answerMode))
    return jsonError('نحوه ارسال پاسخ نامعتبر است')
  if (maxGrade !== null && (!Number.isInteger(maxGrade) || maxGrade < 1 || maxGrade > 1000))
    return jsonError('نمره بیشینه باید عددی بین ۱ تا ۱۰۰۰ باشد')

  let dueAt: Date | null = null
  if (dueAtRaw) {
    dueAt = new Date(dueAtRaw)
    if (isNaN(dueAt.getTime())) return jsonError('مهلت ارسال نامعتبر است')
  }

  // معلم باید واقعاً به این گروه اختصاص داشته باشد
  const group = await db.subjectGroup.findUnique({
    where: { id: subjectGroupId },
    include: { classroom: { select: { id: true, name: true, schoolId: true } } },
  })
  if (!group || !group.classroom || group.classroom.schoolId !== session.schoolId)
    return jsonError('گروه درسی یافت نشد', 404)
  const assigned = await db.teachingAssignment.findFirst({
    where: { teacherId: session.uid, subjectGroupId },
    select: { id: true },
  })
  if (!assigned) return jsonError('شما به این گروه درسی اختصاص ندارید', 403)
  if (group.archivedAt)
    return jsonError('این گروه بایگانی شده و امکان افزودن تکلیف نیست', 403)

  let attachment: { key: string; name: string; mime: string; size: number } | null = null
  if (attachmentKey) {
    const att = await validateStagedAttachment(attachmentKey, session.uid)
    if (typeof att === 'string') return jsonError(att, 400)
    attachment = att
  }

  const created = await db.assignment.create({
    data: {
      subjectGroupId,
      title,
      description,
      answerMode,
      allowEdit,
      maxGrade,
      dueAt,
      createdById: session.uid,
      attachmentName: attachment?.name,
      attachmentKey: attachment?.key,
      attachmentMime: attachment?.mime,
      attachmentSize: attachment?.size,
    },
  })

  // ردیف Upload به‌عنوان کتابخانه رسانه پلتفرم باقی می‌ماند (گالری مدیر کل + شمارش دانلود)

  // اعلان تکلیف جدید برای همه دانش‌آموزان عضو مؤثر گروه
  const students = await effectiveGroupStudents(subjectGroupId, group.classroom.id)
  const dueText = dueAt
    ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(dueAt)
    : 'بدون مهلت'
  await pushNotifications(
    students
      .filter((s) => s.isActive)
      .map((s) => ({
        userId: s.id,
        type: 'ASSIGNMENT_NEW',
        title: `تکلیف جدید: ${title}`,
        body: `${group.name} — مهلت: ${dueText}`,
        link: `/assignments/${created.id}`,
        dedupeKey: `assign:${created.id}`,
      })),
  )

  // پیام خودکار تکلیف در خود گروه (در صورت فعال بودن پیام‌رسانی مدرسه)
  const chatFeatures = await getSchoolFeatures(session.schoolId)
  if (chatFeatures.chat) {
    const announce = await db.message.create({
      data: {
        kind: 'GROUP',
        subjectGroupId,
        senderId: session.uid,
        type: 'ASSIGNMENT',
        body: `تکلیف «${title}» در این گروه ثبت شد.\nمهلت ارسال: ${dueText}`,
        assignmentId: created.id,
        // شناسه قطعی برای به‌روزرسانی/حذف هماهنگ با تکلیف و جلوگیری از تکرار
        clientId: `assign-announce:${created.id}`,
      },
    })
    const serialized = await serializeMessage(announce.id)
    await notifySocket({
      rooms: [roomForGroup(subjectGroupId)],
      event: 'message:new',
      data: serialized,
    })
  }

  await notifySocket({
    rooms: [roomForGroup(subjectGroupId)],
    event: 'assignments:update',
    data: { assignmentId: created.id, action: 'create' },
  })

  return NextResponse.json(
    { id: created.id, message: 'تکلیف ایجاد شد' },
    { status: 201 },
  )
}
