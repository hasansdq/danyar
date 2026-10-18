import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

/** انتساب معلم به گروه درسی */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('groups')
  if ('response' in res) return res.response
  const { id } = await params

  const group = await db.subjectGroup.findFirst({
    where: { id, classroom: { schoolId: res.session.schoolId } },
  })
  if (!group) return jsonError('گروه یافت نشد', 404)

  const body = await req.json().catch(() => null)
  const teacherId = String(body?.teacherId ?? '')
  const teacher = await db.user.findFirst({
    where: { id: teacherId, schoolId: res.session.schoolId, role: 'TEACHER' },
  })
  if (!teacher) return jsonError('معلم یافت نشد', 404)

  const existing = await db.teachingAssignment.findFirst({
    where: { teacherId, subjectGroupId: id },
  })
  if (existing) return jsonError('این معلم قبلاً به گروه منتسب شده است', 409)

  await db.teachingAssignment.create({ data: { teacherId, subjectGroupId: id } })
  return NextResponse.json({ ok: true }, { status: 201 })
}

/** لغو انتساب معلم از گروه درسی */
export async function DELETE(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('groups')
  if ('response' in res) return res.response
  const { id } = await params

  const group = await db.subjectGroup.findFirst({
    where: { id, classroom: { schoolId: res.session.schoolId } },
  })
  if (!group) return jsonError('گروه یافت نشد', 404)

  const teacherId = req.nextUrl.searchParams.get('teacherId') ?? ''
  const assignment = await db.teachingAssignment.findFirst({
    where: { teacherId, subjectGroupId: id },
  })
  if (!assignment) return jsonError('انتساب یافت نشد', 404)

  await db.teachingAssignment.delete({ where: { id: assignment.id } })
  return NextResponse.json({ ok: true })
}
