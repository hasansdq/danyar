import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import { notifySocket } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

async function getOwnedGroup(groupId: string, schoolId: string) {
  return db.subjectGroup.findFirst({
    where: { id: groupId, classroom: { schoolId } },
    include: { classroom: { select: { id: true } } },
  })
}

/** فهرست اعضای مؤثر گروه: دانش‌آموزان کلاس − حذف‌شده‌ها + افزوده‌شده‌ها */
export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('groups')
  if ('response' in res) return res.response
  const { id } = await params

  const group = await getOwnedGroup(id, res.session.schoolId)
  if (!group) {
    // گروه عمومی مدرسه — عضویت خودکار دارد و از این پنل مدیریت نمی‌شود
    const sg = await db.subjectGroup.findUnique({
      where: { id },
      select: { scope: true, schoolId: true },
    })
    if (sg && sg.scope !== 'CLASS' && sg.schoolId === res.session.schoolId) {
      return jsonError('عضویت گروه‌های عمومی مدرسه خودکار است و از این پنل مدیریت نمی‌شود', 400)
    }
    return jsonError('گروه یافت نشد', 404)
  }

  const [enrollments, overrides] = await Promise.all([
    db.classroomEnrollment.findMany({
      where: { classroomId: group.classroom!.id },
      include: {
        student: { select: { id: true, fullName: true, username: true, isActive: true } },
      },
    }),
    db.groupMemberOverride.findMany({
      where: { subjectGroupId: id },
      include: {
        user: { select: { id: true, fullName: true, username: true, isActive: true } },
      },
    }),
  ])

  const members: {
    id: string
    fullName: string
    username: string
    isActive: boolean
    status: 'AUTO' | 'ADDED' | 'REMOVED'
  }[] = []

  for (const e of enrollments) {
    const ov = overrides.find((o) => o.userId === e.studentId)
    members.push({
      ...e.student,
      status:
        ov?.action === 'REMOVE' ? 'REMOVED' : 'AUTO',
    })
  }
  for (const o of overrides) {
    if (o.action === 'ADD') {
      members.push({ ...o.user, status: 'ADDED' })
    }
  }

  const teachers = await db.teachingAssignment.findMany({
    where: { subjectGroupId: id },
    include: { teacher: { select: { id: true, fullName: true, username: true, isActive: true } } },
  })

  return NextResponse.json({
    members: members.sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa')),
    teachers: teachers.map((t) => t.teacher),
  })
}

/** ثبت استثناهای عضویت: افزوده‌ها و حذف‌شده‌ها */
export async function PUT(req: NextRequest, { params }: Params) {
  const res = await requireSchoolManager('groups')
  if ('response' in res) return res.response
  const { id } = await params

  const group = await getOwnedGroup(id, res.session.schoolId)
  if (!group) {
    const sg = await db.subjectGroup.findUnique({
      where: { id },
      select: { scope: true, schoolId: true },
    })
    if (sg && sg.scope !== 'CLASS' && sg.schoolId === res.session.schoolId) {
      return jsonError('عضویت گروه‌های عمومی مدرسه خودکار است و تغییر نمی‌پذیرد', 400)
    }
    return jsonError('گروه یافت نشد', 404)
  }

  const body = await req.json().catch(() => null)
  const adds: string[] = Array.isArray(body?.adds) ? body.adds.map(String) : []
  const removes: string[] = Array.isArray(body?.removes) ? body.removes.map(String) : []

  const affectedUserIds = [...adds, ...removes]

  for (const uid of adds) {
    const user = await db.user.findFirst({
      where: { id: uid, schoolId: res.session.schoolId, role: 'STUDENT' },
    })
    if (!user) return jsonError('دانش‌آموز یافت نشد یا به مدرسه شما تعلق ندارد', 400)
    await db.groupMemberOverride.upsert({
      where: { subjectGroupId_userId: { subjectGroupId: id, userId: uid } },
      create: { subjectGroupId: id, userId: uid, action: 'ADD' },
      update: { action: 'ADD' },
    })
  }

  for (const uid of removes) {
    const user = await db.user.findFirst({
      where: { id: uid, schoolId: res.session.schoolId, role: 'STUDENT' },
    })
    if (!user) return jsonError('دانش‌آموز یافت نشد یا به مدرسه شما تعلق ندارد', 400)
    // اگر ثبت‌نام کلاس دارد → REMOVE؛ اگر ندارد و ADD بوده → حذف رکورد override
    const enrolled = await db.classroomEnrollment.findFirst({
      where: { studentId: uid, classroomId: group.classroom!.id },
    })
    if (enrolled) {
      await db.groupMemberOverride.upsert({
        where: { subjectGroupId_userId: { subjectGroupId: id, userId: uid } },
        create: { subjectGroupId: id, userId: uid, action: 'REMOVE' },
        update: { action: 'REMOVE' },
      })
    } else {
      await db.groupMemberOverride.deleteMany({
        where: { subjectGroupId: id, userId: uid },
      })
    }
  }

  // اعضای تغییرکرده اتاق‌هایشان بازسازی شود
  if (affectedUserIds.length) {
    await notifySocket({ refreshUserIds: affectedUserIds })
  }

  return NextResponse.json({ ok: true })
}
