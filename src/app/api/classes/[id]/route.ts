import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolAdmin, jsonError } from '@/lib/api-auth'
import { GRADE_OPTIONS } from '@/lib/school'

type Params = { params: Promise<{ id: string }> }

async function getOwnedClassroom(classroomId: string, schoolId: string) {
  return db.classroom.findFirst({
    where: { id: classroomId, schoolId },
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const classroom = await getOwnedClassroom(id, res.session.schoolId)
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const groups = await db.subjectGroup.findMany({
    where: { classroomId: id },
    orderBy: { createdAt: 'asc' },
    include: {
      teachingAssignments: {
        include: { teacher: { select: { id: true, fullName: true, username: true } } },
      },
      _count: { select: { messages: true } },
    },
  })

  const enrollments = await db.classroomEnrollment.findMany({
    where: { classroomId: id },
    include: {
      student: { select: { id: true, fullName: true, username: true, isActive: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const groupOverrides = await db.groupMemberOverride.findMany({
    where: { subjectGroup: { classroomId: id } },
    select: { subjectGroupId: true, userId: true, action: true },
  })

  return NextResponse.json({
    classroom,
    groups: groups.map((g) => ({
      ...g,
      archived: !!g.archivedAt,
      archivedAt: g.archivedAt,
      messagePolicy: g.messagePolicy,
      overrideCount: groupOverrides.filter((o) => o.subjectGroupId === g.id).length,
    })),
    students: enrollments.map((e) => e.student),
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const classroom = await getOwnedClassroom(id, res.session.schoolId)
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const data: { name?: string; allowStudentDm?: boolean; grade?: string | null } = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (name.length < 2) return jsonError('نام کلاس باید حداقل ۲ کاراکتر باشد')
    const duplicate = await db.classroom.findFirst({
      where: { schoolId: res.session.schoolId, name, NOT: { id } },
    })
    if (duplicate) return jsonError('کلاسی با این نام در مدرسه شما وجود دارد', 409)
    data.name = name
  }

  if (body.allowStudentDm !== undefined) {
    if (typeof body.allowStudentDm !== 'boolean') {
      return jsonError('مقدار نامعتبر است')
    }
    data.allowStudentDm = body.allowStudentDm
  }

  // اصلاح پایه کلاس — همه دانش‌آموزان کلاس پایهٔ همین کلاس را می‌گیرند
  if (body.grade !== undefined) {
    if (body.grade === null || body.grade === '') {
      data.grade = null
    } else if (typeof body.grade === 'string' && (GRADE_OPTIONS as readonly string[]).includes(body.grade.trim())) {
      data.grade = body.grade.trim()
    } else {
      return jsonError('پایه انتخاب‌شده معتبر نیست')
    }
  }

  const updated = await db.classroom.update({ where: { id }, data })
  return NextResponse.json({ classroom: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const res = await requireSchoolAdmin()
  if ('response' in res) return res.response
  const { id } = await params

  const classroom = await getOwnedClassroom(id, res.session.schoolId)
  if (!classroom) return jsonError('کلاس یافت نشد', 404)

  await db.classroom.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
