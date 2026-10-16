import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { attendanceEnabled, canManageAttendanceSession, ATTENDANCE_STATUSES } from '@/lib/attendance-access'
import { formatJalaliDate } from '@/lib/jalali'
import { pushNotifications } from '@/lib/notifications'

/**
 * GET /api/attendance/sessions/[id] — جزئیات کامل جلسه برای مدیران آن
 * (معلم منتسب همان کلاس یا مدیر همان مدرسه) — بقیه 404
 * شامل رکوردها و تاریخچه کامل اصلاحات (چه کسی، چه زمانی، از چه وضعیتی به چه وضعیتی)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = session.schoolId ? await attendanceEnabled(session.schoolId) : false
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  const att = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      classroom: { select: { id: true, name: true, schoolId: true } },
      creator: { select: { id: true, fullName: true } },
    },
  })
  if (!att) return jsonError('جلسه یافت نشد', 404)

  const canManage = await canManageAttendanceSession(session, att, att.classroom.schoolId)
  if (!canManage) return jsonError('جلسه یافت نشد', 404)

  const [records, edits] = await Promise.all([
    db.attendanceRecord.findMany({
      where: { sessionId: id },
      include: { student: { select: { id: true, fullName: true } } },
      orderBy: { id: 'asc' },
    }),
    db.attendanceEditLog.findMany({
      where: { sessionId: id },
      include: { editor: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // ثبت‌نام‌شدگان فعلی بدون رکورد → UNSET
  const enrolled = await db.classroomEnrollment.findMany({
    where: { classroomId: att.classroomId, student: { isActive: true } },
    select: { student: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const recMap = new Map(records.map((r) => [r.studentId, r]))
  const students = enrolled.map((e) => {
    const r = recMap.get(e.student.id)
    return {
      studentId: e.student.id,
      fullName: e.student.fullName,
      status: r?.status ?? 'UNSET',
      note: r?.note ?? null,
      updatedAt: r?.updatedAt ?? null,
    }
  })
  // دانش‌آموزی که رکورد دارد ولی دیگر ثبت‌نام فعال نیست — حفظ سابقه
  for (const r of records) {
    if (!enrolled.some((e) => e.student.id === r.studentId)) {
      students.push({
        studentId: r.studentId,
        fullName: r.student.fullName,
        status: r.status,
        note: r.note,
        updatedAt: r.updatedAt,
      })
    }
  }

  return NextResponse.json({
    session: {
      id: att.id,
      dateKey: att.dateKey,
      title: att.title,
      status: att.status,
      classroomId: att.classroom.id,
      classroomName: att.classroom.name,
      creatorName: att.creator.fullName,
      finalizedAt: att.finalizedAt,
      createdAt: att.createdAt,
    },
    students,
    edits: edits.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      studentName: students.find((s) => s.studentId === e.studentId)?.fullName ?? '',
      oldStatus: e.oldStatus,
      newStatus: e.newStatus,
      oldNote: e.oldNote,
      newNote: e.newNote,
      editorName: e.editor.fullName,
      createdAt: e.createdAt,
    })),
  })
}

interface PatchRecord {
  studentId: string
  status: string
  note?: string | null
}

/**
 * PATCH /api/attendance/sessions/[id]
 * بدنه: { records?: [{studentId, status: PRESENT|ABSENT, note?}], action?: 'finalize' }
 * - هر تغییر واقعی وضعیت/یادداشت در AttendanceEditLog حفظ می‌شود (با ثبت‌کننده)
 * - نهایی‌سازی: اعلان خصوصی «حضور و غیاب شما ثبت شد» برای هر دانش‌آموز
 *   (dedupeKey یکتا → هرگز تکراری نمی‌شود)
 * - تغییر وضعیت پس از نهایی‌سازی: اعلان خصوصی «اصلاح وضعیت» به دانش‌آموز
 * - هیچ اطلاعاتی در گروه عمومی منتشر نمی‌شود
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const enabled = session.schoolId ? await attendanceEnabled(session.schoolId) : false
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('بدنه درخواست نامعتبر است', 400)
  }
  const b = body as {
    records?: PatchRecord[]
    action?: string
  }

  const att = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      classroom: { select: { id: true, name: true, schoolId: true } },
      creator: { select: { id: true, fullName: true } },
    },
  })
  if (!att) return jsonError('جلسه یافت نشد', 404)

  const canManage = await canManageAttendanceSession(session, att, att.classroom.schoolId)
  if (!canManage) return jsonError('جلسه یافت نشد', 404)

  // اعتبارسنجی ورودی پیش از هر تغییری
  const recInputs = Array.isArray(b.records) ? b.records : []
  if (recInputs.length > 500) return jsonError('تعداد رکوردها بیش از حد مجاز است', 400)
  const seenIds = new Set<string>()
  for (const r of recInputs) {
    if (!r || typeof r.studentId !== 'string' || !r.studentId) {
      return jsonError('رکورد نامعتبر است', 400)
    }
    if (seenIds.has(r.studentId)) return jsonError('رکورد تکراری ارسال شده است', 400)
    seenIds.add(r.studentId)
    if (!ATTENDANCE_STATUSES.includes(r.status as never)) {
      return jsonError('وضعیت نامعتبر است (حاضر یا غایب)', 400)
    }
    if (r.note != null && typeof r.note !== 'string') return jsonError('یادداشت نامعتبر است', 400)
    if ((r.note ?? '').length > 300) return jsonError('یادداشت بیش از حد طولانی است', 400)
  }
  const finalize = b.action === 'finalize'
  if (finalize && att.status === 'FINALIZED') {
    return jsonError('این جلسه قبلاً نهایی شده است', 400)
  }

  const enrolled = await db.classroomEnrollment.findMany({
    where: { classroomId: att.classroomId },
    select: { studentId: true },
  })
  const enrolledSet = new Set(enrolled.map((e) => e.studentId))
  const existingRecords = await db.attendanceRecord.findMany({
    where: { sessionId: id },
    select: { studentId: true, status: true, note: true },
  })
  const recMap = new Map(existingRecords.map((r) => [r.studentId, r]))

  for (const r of recInputs) {
    // دانش‌آموز باید ثبت‌نام کلاس باشد یا قبلاً رکورد داشته باشد (حفظ سابقه خروجی‌ها)
    if (!enrolledSet.has(r.studentId) && !recMap.has(r.studentId)) {
      return jsonError('این دانش‌آموز عضو این کلاس نیست', 400)
    }
  }

  const dateFa = formatJalaliDate(att.dateKey)
  const now = new Date()
  const editLogs: {
    sessionId: string
    studentId: string
    oldStatus: string
    newStatus: string
    oldNote: string | null
    newNote: string | null
    editorId: string
  }[] = []
  const corrections: {
    studentId: string
    oldStatus: string
    newStatus: string
    dedupeKey: string
  }[] = []

  await db.$transaction(async (tx) => {
    for (const r of recInputs) {
      const prev = recMap.get(r.studentId)
      const newNote = r.note?.toString().trim() || null
      if (prev) {
        if (prev.status === r.status && (prev.note ?? null) === newNote) continue // بدون تغییر واقعی
        await tx.attendanceRecord.update({
          where: { sessionId_studentId: { sessionId: id, studentId: r.studentId } },
          data: { status: r.status, note: newNote, updatedAt: now },
        })
        await tx.attendanceEditLog.create({
          data: {
            sessionId: id,
            studentId: r.studentId,
            oldStatus: prev.status,
            newStatus: r.status,
            oldNote: prev.note ?? null,
            newNote,
            editorId: session.uid,
          },
        })
        if (prev.status !== r.status) {
          // شماره اصلاح: تعداد کل اصلاحات ثبت‌شده قبلی این دانش‌آموز در این جلسه + ۱
          const seq = await tx.attendanceEditLog.count({
            where: { sessionId: id, studentId: r.studentId },
          })
          corrections.push({
            studentId: r.studentId,
            oldStatus: prev.status,
            newStatus: r.status,
            dedupeKey: `att-corr:${id}:${r.studentId}:${seq + 1}`,
          })
        }
      } else {
        // رکورد جدید برای ثبت‌نشده
        await tx.attendanceRecord.create({
          data: { sessionId: id, studentId: r.studentId, status: r.status, note: newNote },
        })
        await tx.attendanceEditLog.create({
          data: {
            sessionId: id,
            studentId: r.studentId,
            oldStatus: 'UNSET',
            newStatus: r.status,
            oldNote: null,
            newNote,
            editorId: session.uid,
          },
        })
        if (att.status === 'FINALIZED') {
          const seq = await tx.attendanceEditLog.count({
            where: { sessionId: id, studentId: r.studentId },
          })
          corrections.push({
            studentId: r.studentId,
            oldStatus: 'UNSET',
            newStatus: r.status,
            dedupeKey: `att-corr:${id}:${r.studentId}:${seq + 1}`,
          })
        }
      }
    }

    if (finalize) {
      await tx.attendanceSession.update({
        where: { id },
        data: { status: 'FINALIZED', finalizedAt: now },
      })
    }
  })

  // اعلان اصلاح — فقط تغییر واقعی وضعیت روی جلسه «از قبل نهایی‌شده»
  // (در همان درخواستِ نهایی‌سازی، اعلان نهایی‌سازی کافی است — بدون اعلان دوگانه)
  const wasFinalized = att.status === 'FINALIZED'
  if (wasFinalized && corrections.length) {
    await pushNotifications(
      corrections.map((c) => ({
        userId: c.studentId,
        type: 'ATTENDANCE_CORRECTION',
        title: 'اصلاح وضعیت حضور شما',
        body: `جلسه «${att.title}» کلاس ${att.classroom.name} در تاریخ ${dateFa}: وضعیت شما از «${statusFa(c.oldStatus)}» به «${statusFa(c.newStatus)}» تغییر کرد`,
        link: '/attendance',
        dedupeKey: c.dedupeKey,
      })),
    )
  }

  // اعلان نهایی‌سازی — یک‌بار برای هر دانش‌آموز (dedupeKey یکتا هرگز تکرار نمی‌شود)
  if (finalize) {
    const allRecords = await db.attendanceRecord.findMany({
      where: { sessionId: id },
      select: { studentId: true, status: true },
    })
    await pushNotifications(
      allRecords.map((r) => ({
        userId: r.studentId,
        type: 'ATTENDANCE_FINALIZED',
        title: 'حضور و غیاب شما ثبت شد',
        body: `جلسه «${att.title}» کلاس ${att.classroom.name} در تاریخ ${dateFa}: وضعیت شما «${statusFa(r.status)}» ثبت شد`,
        link: '/attendance',
        dedupeKey: `att-final:${id}:${r.studentId}`,
      })),
    )
  }

  const updated = await db.attendanceSession.findUnique({
    where: { id },
    include: {
      classroom: { select: { id: true, name: true } },
      creator: { select: { id: true, fullName: true } },
      records: { select: { studentId: true, status: true, note: true } },
    },
  })

  return NextResponse.json({
    session: {
      id: updated!.id,
      dateKey: updated!.dateKey,
      title: updated!.title,
      status: updated!.status,
      classroomId: updated!.classroom.id,
      classroomName: updated!.classroom.name,
      creatorName: updated!.creator.fullName,
      finalizedAt: updated!.finalizedAt,
      records: updated!.records,
    },
  })
}

function statusFa(s: string): string {
  if (s === 'PRESENT') return 'حاضر'
  if (s === 'ABSENT') return 'غایب'
  return 'ثبت‌نشده'
}
