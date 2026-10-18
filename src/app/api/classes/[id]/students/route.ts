import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

/** ثبت دانش‌آموز در کلاس */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('classes')
  if ('response' in res) return res.response
  const { id } = await params

  const classroom = await db.classroom.findFirst({
    where: { id, schoolId: res.session.schoolId },
  })
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const body = await req.json().catch(() => null)
  const studentId = String(body?.studentId ?? '')
  const student = await db.user.findFirst({
    where: { id: studentId, schoolId: res.session.schoolId, role: 'STUDENT' },
  })
  if (!student) return jsonError('دانش‌آموز یافت نشد', 404)

  const existing = await db.classroomEnrollment.findFirst({
    where: { studentId, classroomId: id },
  })
  if (existing) return jsonError('این دانش‌آموز قبلاً در کلاس ثبت شده است', 409)

  await db.classroomEnrollment.create({ data: { studentId, classroomId: id } })
  return NextResponse.json({ ok: true }, { status: 201 })
}

/** حذف دانش‌آموز از کلاس */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('classes')
  if ('response' in res) return res.response
  const { id } = await params

  const classroom = await db.classroom.findFirst({
    where: { id, schoolId: res.session.schoolId },
  })
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const studentId = req.nextUrl.searchParams.get('studentId') ?? ''
  const enrollment = await db.classroomEnrollment.findFirst({
    where: { studentId, classroomId: id },
  })
  if (!enrollment) return jsonError('ثبت‌نام یافت نشد', 404)

  await db.classroomEnrollment.delete({ where: { id: enrollment.id } })
  return NextResponse.json({ ok: true })
}
