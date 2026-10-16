import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { jsonError, requireAppRole } from '@/lib/api-auth'
import { attendanceEnabled } from '@/lib/attendance-access'

/**
 * GET /api/attendance/students?classroomId=… [&sessionId=…]
 * فهرست دانش‌آموزان یک کلاس (فقط معلم منتسب همان کلاس و مدیر همان مدرسه).
 * - بدون sessionId: دانش‌آموزان فعال ثبت‌نام‌شده (برای جلسه جدید)
 * - با sessionId: اتحادِ رکوردهای موجود جلسه و ثبت‌نام‌شدگان فعلی —
 *   دانش‌آموزی که رکورد ندارد با status=UNSET (ثبت‌نشده) برمی‌گردد
 * خروجی فقط شامل id و نام است (بدون هیچ اطلاعات دیگری).
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

  const classroomId = req.nextUrl.searchParams.get('classroomId') ?? ''
  const attSessionId = req.nextUrl.searchParams.get('sessionId') ?? ''

  const classroom = await db.classroom.findUnique({
    where: { id: classroomId },
    select: { id: true, schoolId: true, name: true },
  })
  if (!classroom || classroom.schoolId !== session.schoolId) {
    return jsonError('کلاس یافت نشد', 404)
  }
  if (session.role === 'TEACHER') {
    const assigned = await db.teachingAssignment.findFirst({
      where: { teacherId: session.uid, subjectGroup: { classroomId } },
      select: { id: true },
    })
    if (!assigned) return jsonError('کلاس یافت نشد', 404)
  }

  const enrolled = await db.classroomEnrollment.findMany({
    where: { classroomId, student: { isActive: true } },
    select: { student: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'asc' },
  })

  if (!attSessionId) {
    return NextResponse.json({
      students: enrolled.map((e) => ({
        id: e.student.id,
        fullName: e.student.fullName,
        status: 'PRESENT', // پیش‌فرض حاضر
      })),
    })
  }

  // جلسه موجود: باید به همین کلاس تعلق داشته باشد
  const att = await db.attendanceSession.findUnique({
    where: { id: attSessionId },
    select: { id: true, classroomId: true },
  })
  if (!att || att.classroomId !== classroomId) return jsonError('جلسه یافت نشد', 404)

  const records = await db.attendanceRecord.findMany({
    where: { sessionId: attSessionId },
    select: { studentId: true, status: true, note: true },
  })
  const recMap = new Map(records.map((r) => [r.studentId, r]))

  const seen = new Map<string, { id: string; fullName: string; status: string; note?: string | null }>()
  for (const r of records) {
    const u = await db.user.findUnique({
      where: { id: r.studentId },
      select: { id: true, fullName: true },
    })
    if (u) seen.set(u.id, { id: u.id, fullName: u.fullName, status: r.status, note: r.note })
  }
  for (const e of enrolled) {
    if (!seen.has(e.student.id)) {
      seen.set(e.student.id, {
        id: e.student.id,
        fullName: e.student.fullName,
        status: 'UNSET',
        note: null,
      })
    }
  }

  return NextResponse.json({ students: [...seen.values()] })
}
