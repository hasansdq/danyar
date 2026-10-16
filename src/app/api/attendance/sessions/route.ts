import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { attendanceEnabled, accessibleClassrooms } from '@/lib/attendance-access'
import { isValidDateKey } from '@/lib/jalali'

/**
 * GET /api/attendance/sessions?from=1404-07-01&to=1404-07-31 [&classroomId=] [&status=]
 * فهرست جلسات حضور و غیاب در بازه تاریخ جلالی (شامل پیش‌نویس‌ها با برچسب وضعیت):
 * معلم: فقط جلسات کلاس‌های مجاز خودش
 * مدیر مدرسه: همه جلسات مدرسه خودش
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role === 'STUDENT') {
    return jsonError('دانش‌آموز به این بخش دسترسی ندارد', 403)
  }
  const enabled = await attendanceEnabled(session.schoolId)
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const classroomFilter = sp.get('classroomId') ?? ''
  const statusFilter = sp.get('status') ?? ''

  if (from && !isValidDateKey(from)) return jsonError('تاریخ «از» نامعتبر است', 400)
  if (to && !isValidDateKey(to)) return jsonError('تاریخ «تا» نامعتبر است', 400)

  const classrooms = await accessibleClassrooms(session)
  let classroomIds = classrooms.map((c) => c.id)
  if (classroomFilter) classroomIds = classroomIds.filter((id) => id === classroomFilter)

  if (!classroomIds.length) return NextResponse.json({ sessions: [], classrooms })

  const sessions = await db.attendanceSession.findMany({
    where: {
      classroomId: { in: classroomIds },
      // ⚠️ از/تا باید در یک فیلتر dateKey ادغام شوند — دو spread جداگانه روی یک کلید،
      // فیلتر «از» را با «تا» بازنویسی می‌کرد (باگ: فهرست جلسات بازه را رعایت نمی‌کرد)
      ...((from || to)
        ? { dateKey: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: {
      classroom: { select: { id: true, name: true } },
      creator: { select: { id: true, fullName: true } },
      records: { select: { status: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({
    classrooms,
    sessions: sessions.map((s) => {
      const present = s.records.filter((r) => r.status === 'PRESENT').length
      const absent = s.records.filter((r) => r.status === 'ABSENT').length
      return {
        id: s.id,
        dateKey: s.dateKey,
        title: s.title,
        status: s.status,
        classroomId: s.classroom.id,
        classroomName: s.classroom.name,
        creatorName: s.creator.fullName,
        finalizedAt: s.finalizedAt,
        counts: { present, absent, recorded: s.records.length },
      }
    }),
  })
}

/**
 * POST /api/attendance/sessions — ایجاد جلسه پیش‌نویس برای یک کلاس در یک روز
 * بدنه: { classroomId, dateKey, title?, records?: [{studentId, status, note?}] }
 * - عنوان خالی → «جلسه N» (N=تعداد جلسات کلاس +۱)
 * - همه دانش‌آموزان فعال ثبت‌نام‌شده با وضعیت پیش‌فرض «حاضر» رکورد می‌گیرند؛
 *   رکوردهای ارسالی (چک‌باکس‌های غیبت پیش از ذخیره) همان ابتدا اعمال می‌شوند — بدون لاگ اصلاح
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  if (session.role === 'STUDENT') {
    return jsonError('دانش‌آموز اجازه ثبت حضور و غیاب ندارد', 403)
  }
  const enabled = await attendanceEnabled(session.schoolId)
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('بدنه درخواست نامعتبر است', 400)
  }
  const b = body as {
    classroomId?: string
    dateKey?: string
    title?: string
    records?: { studentId?: string; status?: string; note?: string }[]
  }

  if (!b.classroomId || typeof b.classroomId !== 'string') {
    return jsonError('کلاس را انتخاب کنید', 400)
  }
  const p = isValidDateKey(b.dateKey)
  if (!p) return jsonError('تاریخ نامعتبر است (قالب: 1404-07-19)', 400)

  const classroom = await db.classroom.findUnique({
    where: { id: b.classroomId },
    select: { id: true, schoolId: true, name: true },
  })
  if (!classroom || classroom.schoolId !== session.schoolId) {
    return jsonError('کلاس یافت نشد', 404)
  }
  if (session.role === 'TEACHER') {
    const assigned = await db.teachingAssignment.findFirst({
      where: { teacherId: session.uid, subjectGroup: { classroomId: b.classroomId } },
      select: { id: true },
    })
    if (!assigned) return jsonError('کلاس یافت نشد', 404)
  }

  const title = (b.title ?? '').toString().trim()
  if (title.length > 80) return jsonError('عنوان جلسه بیش از حد طولانی است', 400)

  // عنوان پیش‌فرض: «جلسه N» بر اساس تعداد جلسات قبلی همین کلاس
  const existingCount = await db.attendanceSession.count({ where: { classroomId: b.classroomId } })
  const finalTitle = title || `جلسه ${existingCount + 1}`

  const dup = await db.attendanceSession.findUnique({
    where: {
      classroomId_dateKey_title: {
        classroomId: b.classroomId,
        dateKey: b.dateKey!,
        title: finalTitle,
      },
    },
    select: { id: true },
  })
  if (dup) {
    return jsonError('برای این کلاس در این روز جلسه‌ای با همین عنوان وجود دارد', 409)
  }

  // دانش‌آموزان فعال ثبت‌نام‌شده — همه پیش‌فرض حاضر
  const enrolled = await db.classroomEnrollment.findMany({
    where: { classroomId: b.classroomId, student: { isActive: true } },
    select: { studentId: true },
    orderBy: { createdAt: 'asc' },
  })

  // وضعیت‌های اولیه ارسالی (چک‌باکس‌ها پیش از ذخیره) — فقط وضعیت مجاز و فقط ثبت‌نام‌شدگان
  const initialStatus = new Map<string, { status: string; note: string | null }>()
  for (const r of Array.isArray(b.records) ? b.records : []) {
    if (!r || typeof r.studentId !== 'string') continue
    if (!enrolled.some((e) => e.studentId === r.studentId)) continue
    if (r.status !== 'PRESENT' && r.status !== 'ABSENT') continue
    initialStatus.set(r.studentId, {
      status: r.status,
      note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null,
    })
  }

  const created = await db.attendanceSession.create({
    data: {
      classroomId: b.classroomId,
      dateKey: b.dateKey!,
      title: finalTitle,
      creatorId: session.uid,
      status: 'DRAFT',
      records: {
        create: enrolled.map((e) => ({
          studentId: e.studentId,
          status: initialStatus.get(e.studentId)?.status ?? 'PRESENT',
          note: initialStatus.get(e.studentId)?.note ?? null,
        })),
      },
    },
    include: {
      classroom: { select: { id: true, name: true } },
      creator: { select: { id: true, fullName: true } },
      records: { select: { studentId: true, status: true, note: true } },
    },
  })

  return NextResponse.json(
    {
      session: {
        id: created.id,
        dateKey: created.dateKey,
        title: created.title,
        status: created.status,
        classroomId: created.classroom.id,
        classroomName: created.classroom.name,
        creatorName: created.creator.fullName,
        finalizedAt: created.finalizedAt,
        records: created.records,
      },
    },
    { status: 201 },
  )
}
