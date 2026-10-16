import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import {
  getSchoolFeatures,
  isEffectiveStudentMember,
  getGroupById,
  roleLabel,
} from '@/lib/chat-access'

export interface DmCandidate {
  id: string
  fullName: string
  role: string
  label: string
  note?: string
}

/**
 * فهرست کاربرانی که کاربر فعلی مجاز به گفتگوی خصوصی با آن‌هاست.
 * همان ماتریس دسترسی canDirectMessage — اما به‌صورت فهرست برای رابط کاربری.
 */
export async function listDmCandidates(
  session: SessionPayload,
): Promise<{ enabled: boolean; candidates: DmCandidate[] }> {
  if (!session.schoolId) return { enabled: false, candidates: [] }
  const features = await getSchoolFeatures(session.schoolId)

  const schoolUsers = (roles: string[]) =>
    db.user.findMany({
      where: {
        schoolId: session.schoolId,
        isActive: true,
        role: { in: roles },
        NOT: { id: session.uid },
      },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    })

  const toCandidates = (
    rows: { id: string; fullName: string; role: string }[],
    note?: (r: { id: string; fullName: string; role: string }) => string | undefined,
  ): DmCandidate[] =>
    rows.map((r) => ({
      ...r,
      label: roleLabel(r.role),
      note: note?.(r),
    }))

  // مدیر مدرسه: با همه کاربران مدرسه
  if (session.role === 'SCHOOL_ADMIN') {
    const rows = await schoolUsers(['TEACHER', 'SCHOOL_VICE', 'STUDENT', 'SCHOOL_ADMIN'])
    return { enabled: true, candidates: toCandidates(rows) }
  }

  // معاون مدرسه — عضو ستاد: با همه کاربران مدرسه
  if (session.role === 'SCHOOL_VICE') {
    const rows = await schoolUsers(['TEACHER', 'STUDENT', 'SCHOOL_ADMIN'])
    return { enabled: true, candidates: toCandidates(rows) }
  }

  if (!features.dm) return { enabled: false, candidates: [] }

  if (session.role === 'TEACHER') {
    const [admins, assignments] = await Promise.all([
      schoolUsers(['SCHOOL_ADMIN', 'SCHOOL_VICE']),
      db.teachingAssignment.findMany({
        where: { teacherId: session.uid },
        select: { subjectGroupId: true },
      }),
    ])
    const studentIds = new Set<string>()
    for (const a of assignments) {
      const group = await getGroupById(a.subjectGroupId)
      if (!group || !group.classroom) continue
      const enrolled = await db.classroomEnrollment.findMany({
        where: { classroomId: group.classroom.id },
        select: { studentId: true },
      })
      for (const e of enrolled) studentIds.add(e.studentId)
      const added = await db.groupMemberOverride.findMany({
        where: { subjectGroupId: group.id, action: 'ADD' },
        select: { userId: true },
      })
      const removed = new Set(
        (
          await db.groupMemberOverride.findMany({
            where: { subjectGroupId: group.id, action: 'REMOVE' },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      )
      for (const a2 of added) {
        if (!removed.has(a2.userId)) studentIds.add(a2.userId)
      }
    }
    const students = studentIds.size
      ? await db.user.findMany({
          where: {
            id: { in: [...studentIds] },
            isActive: true,
            role: 'STUDENT',
          },
          select: { id: true, fullName: true, role: true },
          orderBy: { fullName: 'asc' },
        })
      : []
    return {
      enabled: true,
      candidates: [
        ...toCandidates(admins),
        ...toCandidates(students, () => 'دانش‌آموز گروه‌های من'),
      ],
    }
  }

  // STUDENT
  const [admins, assignments] = await Promise.all([
    schoolUsers(['SCHOOL_ADMIN', 'SCHOOL_VICE']),
    db.teachingAssignment.findMany({
      where: {
        subjectGroup: {
          classroom: {
            schoolId: session.schoolId,
            enrollments: { some: { studentId: session.uid } },
          },
        },
      },
      select: { subjectGroupId: true, teacherId: true },
    }),
  ])

  // معلمان گروه‌های مؤثر دانش‌آموز
  const teacherIds = new Set<string>()
  for (const a of assignments) {
    const group = await getGroupById(a.subjectGroupId)
    if (!group || !group.classroom) continue
    if (await isEffectiveStudentMember(group.id, group.classroom.id, session.uid)) {
      teacherIds.add(a.teacherId)
    }
  }
  const teachers = teacherIds.size
    ? await db.user.findMany({
        where: { id: { in: [...teacherIds] }, isActive: true, role: 'TEACHER' },
        select: { id: true, fullName: true, role: true },
        orderBy: { fullName: 'asc' },
      })
    : []

  // هم‌کلاسی‌ها فقط اگر مدیر فعال کرده باشد
  let classmates: DmCandidate[] = []
  const myEnrollments = await db.classroomEnrollment.findMany({
    where: { studentId: session.uid },
    select: { classroom: { select: { id: true, name: true, allowStudentDm: true } } },
  })
  for (const enr of myEnrollments) {
    if (!enr.classroom.allowStudentDm) continue
    const rows = await db.classroomEnrollment.findMany({
      where: {
        classroomId: enr.classroom.id,
        NOT: { studentId: session.uid },
      },
      select: { student: { select: { id: true, fullName: true, role: true } } },
    })
    classmates.push(
      ...toCandidates(
        rows.map((r) => r.student),
        () => `هم‌کلاسی (${enr.classroom.name})`,
      ),
    )
  }
  // حذف تکراری‌ها
  const seen = new Set<string>()
  classmates = classmates.filter((c) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })

  return {
    enabled: true,
    candidates: [
      ...toCandidates(admins),
      ...toCandidates(teachers, () => 'معلم گروه‌های من'),
      ...classmates,
    ],
  }
}
