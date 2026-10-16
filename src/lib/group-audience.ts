import { db } from '@/lib/db'

/**
 * شنوندگان واقعی یک گروه پیام‌رسانی (برای اعلان پیام گروهی و بررسی مجوز در زمان ارسال پوش):
 *
 * گروه درسی کلاس (scope=CLASS):
 *   دانش‌آموزان ثبت‌نام‌شده کلاس − استثناها + افزودنی‌ها + معلمان منتسب + مدیر مدرسه
 *
 * گروه‌های عمومی مدرسه — عضویت خودکار:
 *   SCHOOL_STAFF: همه معلمان + مدیران مدرسه
 *   SCHOOL_ALL:   همه دانش‌آموزان + معلمان + مدیران مدرسه
 *   GRADE:        دانش‌آموزان کلاس‌های آن پایه + معلمان همان پایه + مدیران مدرسه
 *
 * (در فایل مستقل تا هم lib/notifications و هم lib/push بدون وابستگی حلقوی استفاده کنند)
 */

export type GroupAudienceRef = {
  id: string
  scope: string
  grade: string | null
  classroomId: string | null
  schoolId: string | null
  classroom?: { schoolId: string } | null
}

/** شناسه مدرسهٔ مؤثر گروه (کلاسی از کلاس، عمومی از ستون schoolId) */
function schoolIdOf(g: GroupAudienceRef): string | null {
  return g.classroom?.schoolId ?? g.schoolId ?? null
}

export async function effectiveGroupAudience(
  group: GroupAudienceRef,
): Promise<{ id: string; fullName: string; isActive: boolean }[]> {
  const scope = group.scope
  const map = new Map<string, { id: string; fullName: string; isActive: boolean }>()

  if (scope === 'CLASS' && group.classroomId) {
    const [enrollments, overrides, teachers, admins] = await Promise.all([
      db.classroomEnrollment.findMany({
        where: { classroomId: group.classroomId },
        select: { student: { select: { id: true, fullName: true, isActive: true } } },
      }),
      db.groupMemberOverride.findMany({
        where: { subjectGroupId: group.id },
        select: { userId: true, action: true },
      }),
      db.teachingAssignment.findMany({
        where: { subjectGroupId: group.id },
        select: { teacher: { select: { id: true, fullName: true, isActive: true } } },
      }),
      db.user.findMany({
        where: { schoolId: schoolIdOf(group), role: 'SCHOOL_ADMIN', isActive: true },
        select: { id: true, fullName: true, isActive: true },
      }),
    ])
    for (const e of enrollments) map.set(e.student.id, e.student)
    for (const t of teachers) map.set(t.teacher.id, t.teacher)
    for (const a of admins) map.set(a.id, a)
    for (const o of overrides) {
      if (o.action === 'REMOVE') {
        map.delete(o.userId)
      } else if (o.action === 'ADD' && !map.has(o.userId)) {
        const u = await db.user.findUnique({
          where: { id: o.userId },
          select: { id: true, fullName: true, isActive: true },
        })
        if (u) map.set(u.id, u)
      }
    }
    return [...map.values()]
  }

  const schoolId = schoolIdOf(group)
  if (!schoolId) return []

  const wantsStudents =
    scope === 'SCHOOL_ALL' || (scope === 'GRADE' && !!group.grade)
  const gradeClause =
    scope === 'GRADE' && group.grade
      ? { schoolId, grade: group.grade }
      : { schoolId }

  const [students, teachers, admins] = await Promise.all([
    wantsStudents
      ? scope === 'GRADE'
        ? db.classroomEnrollment.findMany({
            where: { classroom: gradeClause, student: { isActive: true } },
            select: { student: { select: { id: true, fullName: true, isActive: true } } },
          })
        : db.user.findMany({
            where: { schoolId, role: 'STUDENT', isActive: true },
            select: { id: true, fullName: true, isActive: true },
          }).then((rows) => rows.map((s) => ({ student: s })))
      : Promise.resolve([] as { student: { id: string; fullName: string; isActive: boolean } }[]),
    // گروه سفارشی هیچ عضو خودکاری ندارد (حتی معلمان) — فقط مدیران + انتخاب‌های مدیر
    scope === 'CUSTOM'
      ? Promise.resolve([] as { teacher: { id: string; fullName: string; isActive: boolean } }[])
      : scope === 'GRADE'
        ? db.teachingAssignment.findMany({
            where: { subjectGroup: { classroom: gradeClause }, teacher: { isActive: true } },
            select: { teacher: { select: { id: true, fullName: true, isActive: true } } },
          })
        : db.user.findMany({
            where: { schoolId, role: 'TEACHER', isActive: true },
            select: { id: true, fullName: true, isActive: true },
          }).then((rows) => rows.map((t) => ({ teacher: t }))),
    db.user.findMany({
      where: {
        schoolId,
        role: { in: ['SCHOOL_ADMIN', 'SCHOOL_VICE'] },
        isActive: true,
      },
      select: { id: true, fullName: true, isActive: true },
    }),
  ])

  for (const e of students) map.set(e.student.id, e.student)
  for (const t of teachers) map.set(t.teacher.id, t.teacher)
  for (const a of admins) map.set(a.id, a)

  // گروه سفارشی — هیچ عضو خودکاری ندارد؛ فقط انتخاب‌های مدیر (استثنای ADD)
  if (scope === 'CUSTOM') {
    const adds = await db.groupMemberOverride.findMany({
      where: { subjectGroupId: group.id, action: 'ADD' },
      select: { userId: true },
    })
    for (const a of adds) {
      if (map.has(a.userId)) continue
      const u = await db.user.findUnique({
        where: { id: a.userId },
        select: { id: true, fullName: true, isActive: true },
      })
      if (u && u.isActive) map.set(u.id, u)
    }
  }

  return [...map.values()]
}
