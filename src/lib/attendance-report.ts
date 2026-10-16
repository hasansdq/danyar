import { db } from '@/lib/db'

/**
 * موتور گزارش حضور و غیاب مدیر مدرسه — مشترک بین نمایش و خروجی اکسل.
 * - فقط جلسات «نهایی‌شده» وارد گزارش و آمار می‌شوند (پیش‌نویس محاسبه نمی‌شود)
 * - دانش‌آموز ثبت‌نام‌شده بدون رکورد در جلسه = UNSET (ثبت‌نشده) — جدا از غیبت
 * - همه داده‌ها فقط از مدرسه خود مدیر
 */

export interface ReportFilters {
  classroomId?: string
  teacherId?: string
  studentId?: string
  from?: string
  to?: string
  status?: string // PRESENT | ABSENT | UNSET
}

export interface ReportRow {
  sessionId: string
  sessionTitle: string
  dateKey: string
  classroomId: string
  classroomName: string
  studentId: string
  studentName: string
  status: string // PRESENT | ABSENT | UNSET
  note: string | null
  creatorName: string
  finalizedAt: Date | null
}

export async function buildAttendanceReport(schoolId: string, f: ReportFilters) {
  const sessions = await db.attendanceSession.findMany({
    where: {
      status: 'FINALIZED',
      classroom: { schoolId },
      ...(f.classroomId ? { classroomId: f.classroomId } : {}),
      ...(f.teacherId ? { creatorId: f.teacherId } : {}),
      ...(f.from || f.to
        ? {
            dateKey: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {}),
    },
    include: {
      classroom: { select: { id: true, name: true } },
      creator: { select: { id: true, fullName: true } },
      records: {
        select: { studentId: true, status: true, note: true, updatedAt: true },
      },
    },
    orderBy: [{ dateKey: 'desc' }, { title: 'asc' }],
  })

  // ثبت‌نام‌های همه کلاس‌های درگیر (یک کوئری)
  const classroomIds = [...new Set(sessions.map((s) => s.classroom.id))]
  const enrollments = classroomIds.length
    ? await db.classroomEnrollment.findMany({
        where: { classroomId: { in: classroomIds }, student: { isActive: true } },
        select: { classroomId: true, student: { select: { id: true, fullName: true } } },
      })
    : []
  const enrolledByClass = new Map<string, { id: string; fullName: string }[]>()
  for (const e of enrollments) {
    const list = enrolledByClass.get(e.classroomId) ?? []
    list.push({ id: e.student.id, fullName: e.student.fullName })
    enrolledByClass.set(e.classroomId, list)
  }

  let rows: ReportRow[] = []
  for (const s of sessions) {
    const recMap = new Map(s.records.map((r) => [r.studentId, r]))
    const students = enrolledByClass.get(s.classroom.id) ?? []
    for (const st of students) {
      const r = recMap.get(st.id)
      rows.push({
        sessionId: s.id,
        sessionTitle: s.title,
        dateKey: s.dateKey,
        classroomId: s.classroom.id,
        classroomName: s.classroom.name,
        studentId: st.id,
        studentName: st.fullName,
        status: r?.status ?? 'UNSET',
        note: r?.note ?? null,
        creatorName: s.creator.fullName,
        finalizedAt: s.finalizedAt,
      })
    }
    // دانش‌آموزی که رکورد دارد ولی دیگر فعال/ثبت‌نام نیست — حفظ سابقه در گزارش
    for (const r of s.records) {
      if (!students.some((st) => st.id === r.studentId)) {
        const u = await db.user.findUnique({
          where: { id: r.studentId },
          select: { fullName: true },
        })
        rows.push({
          sessionId: s.id,
          sessionTitle: s.title,
          dateKey: s.dateKey,
          classroomId: s.classroom.id,
          classroomName: s.classroom.name,
          studentId: r.studentId,
          studentName: u?.fullName ?? '—',
          status: r.status,
          note: r.note,
          creatorName: s.creator.fullName,
          finalizedAt: s.finalizedAt,
        })
      }
    }
  }

  // فیلتر دانش‌آموز (سطح ردیف)
  if (f.studentId) rows = rows.filter((r) => r.studentId === f.studentId)

  // ردیف‌های کامل (پیش از فیلتر وضعیت) برای آمار
  const rowsForStats = [...rows]

  // فیلتر وضعیت (سطح ردیف)
  if (f.status) rows = rows.filter((r) => r.status === f.status)

  // ─── آمار (بدون اثر فیلتر وضعیت؛ ثبت‌نشده جدا از غیبت) ───
  const perStudentMap = new Map<string, { name: string; present: number; absent: number; unset: number; sessions: Set<string> }>()
  const perClassMap = new Map<string, { name: string; present: number; absent: number; unset: number; sessions: Set<string> }>()
  for (const r of rowsForStats) {
    const ps = perStudentMap.get(r.studentId) ?? { name: r.studentName, present: 0, absent: 0, unset: 0, sessions: new Set<string>() }
    const pc = perClassMap.get(r.classroomId) ?? { name: r.classroomName, present: 0, absent: 0, unset: 0, sessions: new Set<string>() }
    ps.sessions.add(r.sessionId)
    pc.sessions.add(r.sessionId)
    if (r.status === 'PRESENT') ps.present++
    else if (r.status === 'ABSENT') ps.absent++
    else ps.unset++
    if (r.status === 'PRESENT') pc.present++
    else if (r.status === 'ABSENT') pc.absent++
    else pc.unset++
    perStudentMap.set(r.studentId, ps)
    perClassMap.set(r.classroomId, pc)
  }

  // کلاس‌های هر دانش‌آموز برای شیت آمار
  const studentClasses = new Map<string, Set<string>>()
  for (const r of rowsForStats) {
    const set = studentClasses.get(r.studentId) ?? new Set<string>()
    set.add(r.classroomName)
    studentClasses.set(r.studentId, set)
  }

  const perStudent = [...perStudentMap.entries()]
    .map(([id, v]) => ({
      studentId: id,
      fullName: v.name,
      className: [...(studentClasses.get(id) ?? [])].join('، '),
      present: v.present,
      absent: v.absent,
      unset: v.unset,
      sessions: v.sessions.size,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))

  const perClass = [...perClassMap.entries()]
    .map(([id, v]) => ({
      classroomId: id,
      name: v.name,
      present: v.present,
      absent: v.absent,
      unset: v.unset,
      sessions: v.sessions.size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fa'))

  // گزینه‌های فیلتر (محدود به مدرسه)
  const [classrooms, teachers, students] = await Promise.all([
    db.classroom.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { schoolId, role: { in: ['TEACHER', 'SCHOOL_ADMIN'] }, isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, role: true },
    }),
    db.user.findMany({
      where: { schoolId, role: 'STUDENT', isActive: true },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true },
    }),
  ])

  return {
    rows,
    stats: { perStudent, perClass },
    options: {
      classrooms,
      teachers: teachers.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        roleLabel: t.role === 'SCHOOL_ADMIN' ? 'مدیر مدرسه' : 'معلم',
      })),
      students,
    },
  }
}
