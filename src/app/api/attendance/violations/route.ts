import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { attendanceEnabled, canManageAttendanceSession } from '@/lib/attendance-access'
import { vicePermissionDenied } from '@/lib/vice-permissions'
import { isValidDateKey, formatJalaliDate } from '@/lib/jalali'
import { teacherAssignedToClassroom } from '@/lib/live-access'
import { pushNotifications } from '@/lib/notifications'

/**
 * GET /api/attendance/violations — فهرست تخلفات
 * - ?sessionId=… → تخلفات همان جلسه (برای ویرایشگر جلسه)
 * - ?classroomId=…&dateKey=… → تخلفات کلاس در آن روز
 * - ?studentId=… → همهٔ تخلفات یک دانش‌آموز (پنل خود دانش‌آموز / مدیر)
 * دسترسی: معلمِ منتسبِ همان کلاس، مدیر و معاون همان مدرسه؛ دانش‌آموز فقط خودش.
 */
export async function GET(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const sp = req.nextUrl.searchParams
  const sessionId = sp.get('sessionId') ?? ''
  const classroomId = sp.get('classroomId') ?? ''
  const dateKey = sp.get('dateKey') ?? ''
  const studentId = sp.get('studentId') ?? ''

  if (!sessionId && !classroomId && !studentId) {
    return jsonError('پارامتر جست‌وجو الزامی است', 400)
  }
  if (dateKey && !isValidDateKey(dateKey)) return jsonError('تاریخ نامعتبر است', 400)

  // دانش‌آموز فقط تخلفات خودش را می‌بیند (بخش «حضور و غیاب من»)
  if (session.role === 'STUDENT') {
    if (studentId && studentId !== session.uid) {
      return jsonError('دسترسی غیرمجاز', 403)
    }
    const rows = await listViolations({ studentId: session.uid })
    return NextResponse.json({ violations: rows })
  }

  // جلسه مشخص → دسترسی از طریق جلسه (معلم منتسب / مدیر / معاون همان مدرسه)
  if (sessionId) {
    const att = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { classroom: { select: { id: true, schoolId: true } } },
    })
    if (!att) return jsonError('جلسه یافت نشد', 404)
    const canManage = await canManageAttendanceSession(session, att, att.classroom.schoolId)
    if (!canManage) return jsonError('جلسه یافت نشد', 404)
    const rows = await listViolations({ sessionId, classroomId: att.classroomId, dateKey: att.dateKey })
    return NextResponse.json({ violations: rows })
  }

  // کلاس مشخص → معلم منتسب یا مدیر/معاون همان مدرسه
  if (classroomId) {
    const classroom = await db.classroom.findUnique({
      where: { id: classroomId },
      select: { id: true, schoolId: true },
    })
    if (!classroom) return jsonError('کلاس یافت نشد', 404)
    if (!session.schoolId || session.schoolId !== classroom.schoolId) {
      return jsonError('دسترسی غیرمجاز', 403)
    }
    if (session.role === 'TEACHER') {
      const assigned = await teacherAssignedToClassroom(session.uid, classroomId)
      if (!assigned) return jsonError('دسترسی غیرمجاز', 403)
    }
    const rows = await listViolations({ classroomId, dateKey: dateKey || undefined })
    return NextResponse.json({ violations: rows })
  }

  // فقط studentId — معلم/مدیر/معاون: تخلفات دانش‌آموزِ همان مدرسه
  const student = await db.user.findUnique({
    where: { id: studentId },
    select: { id: true, schoolId: true, role: true },
  })
  if (!student || student.role !== 'STUDENT') return jsonError('دانش‌آموز یافت نشد', 404)
  if (!session.schoolId || session.schoolId !== student.schoolId) {
    return jsonError('دسترسی غیرمجاز', 403)
  }
  const rows = await listViolations({ studentId })
  return NextResponse.json({ violations: rows })
}

async function listViolations(filter: {
  sessionId?: string
  classroomId?: string
  dateKey?: string
  studentId?: string
}) {
  const rows = await db.studentViolation.findMany({
    where: {
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.classroomId ? { classroomId: filter.classroomId } : {}),
      ...(filter.dateKey ? { dateKey: filter.dateKey } : {}),
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
    },
    include: {
      student: { select: { id: true, fullName: true } },
      creator: { select: { id: true, fullName: true } },
      classroom: { select: { id: true, name: true } },
    },
    orderBy: [{ dateKey: 'desc' }, { createdAt: 'desc' }],
  })
  return rows.map((v) => ({
    id: v.id,
    studentId: v.studentId,
    studentName: v.student.fullName,
    classroomId: v.classroomId,
    classroomName: v.classroom.name,
    dateKey: v.dateKey,
    text: v.text,
    creatorId: v.creatorId,
    creatorName: v.creator.fullName,
    createdAt: v.createdAt,
  }))
}

/**
 * POST /api/attendance/violations — ثبت تخلف دانش‌آموز (درخواست کاربر)
 * بدنه: { studentId, classroomId, dateKey, texts: string[], sessionId? } — فهرست چندانتخابی
 * از «انواع تخلف» (مدیریت از پنل مدیر کل). برای سازگاری، text تکی قدیمی هم پذیرفته می‌شود
 * فقط اگر با گزینهٔ فعالی هم‌خوان باشد.
 * فقط مدیر مدرسه / معاون (با مجوز attendance) / معلمِ منتسبِ همان کلاس.
 * اعلان خصوصی برای دانش‌آموز ارسال می‌شود (بدون انتشار در گروه‌های عمومی).
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  if (session.role === 'STUDENT') {
    return jsonError('دانش‌آموز نمی‌تواند تخلف ثبت کند', 403)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('بدنه درخواست نامعتبر است', 400)
  }
  const b = body as {
    studentId?: string
    classroomId?: string
    dateKey?: string
    /** فهرست چندانتخابی انواع تخلف (درخواست کاربر) */
    texts?: unknown
    /** سازگاری قدیمی — متن تکی */
    text?: string
    sessionId?: string | null
  }

  const studentId = String(b.studentId ?? '')
  const classroomId = String(b.classroomId ?? '')
  const dateKey = String(b.dateKey ?? '')
  const sessionId = b.sessionId ? String(b.sessionId) : null

  // متن‌ها: آرایهٔ چندانتخابی (یا text تکی قدیمی) — یکتا و مرتب
  const rawTexts = Array.isArray(b.texts)
    ? b.texts.map((t) => String(t ?? '').trim())
    : [String(b.text ?? '').trim()]
  const texts = [...new Set(rawTexts)].filter((t) => t.length > 0)

  if (!studentId || !classroomId || !dateKey) return jsonError('اطلاعات ناقص است', 400)
  if (!isValidDateKey(dateKey)) return jsonError('تاریخ نامعتبر است', 400)
  if (texts.length === 0) return jsonError('حداقل یک نوع تخلف انتخاب کنید', 400)
  if (texts.length > 20) return jsonError('حداکثر ۲۰ تخلف در هر ثبت', 400)
  for (const t of texts) {
    if (t.length < 2) return jsonError('متن تخلف حداقل ۲ کاراکتر است', 400)
    if (t.length > 300) return jsonError('متن تخلف بیش از حد طولانی است', 400)
  }

  // هر متن باید با گزینهٔ فعلی از «انواع تخلف» (مدیریت مدیر کل) هم‌خوان باشد
  const activeTypes = await db.violationType.findMany({
    where: { isActive: true },
    select: { label: true },
  })
  const activeLabels = new Set(activeTypes.map((t) => t.label))
  if (activeLabels.size === 0) {
    return jsonError('هیچ نوع تخلفی تعریف نشده است — مدیر کل باید از پنل گزینه‌ها را تعریف کند', 400)
  }
  const invalid = texts.find((t) => !activeLabels.has(t))
  if (invalid) {
    return jsonError(`«${invalid}» در فهرست انواع تخلف نیست — از فهرست انتخاب کنید`, 400)
  }

  const enabled = session.schoolId ? await attendanceEnabled(session.schoolId) : false
  if (!enabled) return jsonError('حضور و غیاب برای این مدرسه غیرفعال است', 403)

  // معاون باید مجوز مدیریت حضور و غیاب را داشته باشد
  const denied = await vicePermissionDenied(session, 'attendance')
  if (denied) return denied

  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, name: true, schoolId: true },
  })
  if (!classroom || !session.schoolId || classroom.schoolId !== session.schoolId) {
    return jsonError('کلاس یافت نشد', 404)
  }

  if (session.role === 'TEACHER') {
    const assigned = await teacherAssignedToClassroom(session.uid, classroomId)
    if (!assigned) return jsonError('شما به این کلاس منتسب نیستید', 403)
  }

  const student = await db.user.findUnique({
    where: { id: studentId },
    select: { id: true, schoolId: true, role: true, fullName: true },
  })
  if (!student || student.role !== 'STUDENT' || student.schoolId !== session.schoolId) {
    return jsonError('دانش‌آموز در این مدرسه یافت نشد', 404)
  }

  // اگر جلسه ارسال شده باید متعلق به همین کلاس/روز باشد
  if (sessionId) {
    const att = await db.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { id: true, classroomId: true, dateKey: true },
    })
    if (!att || att.classroomId !== classroomId || att.dateKey !== dateKey) {
      return jsonError('جلسه با این کلاس/روز هم‌خوان نیست', 400)
    }
  }

  await db.studentViolation.createMany({
    data: texts.map((t) => ({
      studentId,
      classroomId,
      dateKey,
      text: t,
      sessionId,
      creatorId: session.uid,
    })),
  })
  const rows = await db.studentViolation.findMany({
    where: {
      studentId,
      classroomId,
      dateKey,
      sessionId,
      creatorId: session.uid,
      text: { in: texts },
    },
    include: { creator: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  })

  // اعلان خصوصی برای دانش‌آموز — «تخلف شما ثبت شد» (بدون متن تخلف در اعلان)
  const dateFa = formatJalaliDate(dateKey)
  await pushNotifications(
    rows.map((r) => ({
      userId: studentId,
      type: 'VIOLATION_RECORDED',
      title: 'تخلفی برای شما ثبت شد',
      body: `در تاریخ ${dateFa} کلاس ${classroom.name} ${rows.length > 1 ? `${rows.length} تخلف` : 'تخلفی'} ثبت شد — جزئیات در بخش «حضور و غیاب»`,
      link: '/attendance',
      dedupeKey: `violation:${r.id}`,
    })),
  )

  // 201 — هم‌قاعدهٔ سایر endpointهای ایجاد (جلسه/تکلیف/رویداد)؛ res.ok رفتار خود را حفظ می‌کند
  return NextResponse.json(
    {
      violations: rows.map((r) => ({
        id: r.id,
        studentId,
        studentName: student.fullName,
        classroomId,
        classroomName: classroom.name,
        dateKey,
        text: r.text,
        creatorId: session.uid,
        creatorName: r.creator.fullName,
        createdAt: r.createdAt,
      })),
    },
    { status: 201 },
  )
}
