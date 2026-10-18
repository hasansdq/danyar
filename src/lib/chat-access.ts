import { db } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'
import { parseFeatures, type SchoolFeatures } from '@/lib/features'

/**
 * موتور دسترسی پیام‌رسان — همه بررسی‌ها سمت سرور انجام می‌شود.
 * دانستن شناسه گروه یا کاربر به‌تنهایی هیچ دسترسی‌ای ایجاد نمی‌کند.
 *
 * دو نوع گروه:
 * - گروه درسی کلاس (scope=CLASS) — عضویت از ثبت‌نام کلاس + استثناها
 * - گروه عمومی مدرسه (SCHOOL_STAFF | SCHOOL_ALL | GRADE) — عضویت خودکار بر اساس نقش/پایه
 */

export type GroupScope = 'CLASS' | 'SCHOOL_STAFF' | 'SCHOOL_ALL' | 'GRADE' | 'CUSTOM'

export type GroupWithContext = NonNullable<
  Awaited<ReturnType<typeof getGroupById>>
>

export function getGroupById(groupId: string) {
  return db.subjectGroup.findUnique({
    where: { id: groupId },
    include: {
      classroom: { select: { id: true, name: true, schoolId: true, grade: true } },
    },
  })
}

/** شناسه مدرسهٔ گروه — گروه کلاسی از کلاس، گروه عمومی از ستون schoolId */
export function groupSchoolId(
  g: { classroom: { schoolId: string } | null; schoolId: string | null },
): string | null {
  return g.classroom?.schoolId ?? g.schoolId ?? null
}

/** زیرعنوان گروه برای نمایش در فهرست/هدر گفتگو */
export function groupSubtitle(
  g: { scope: string; grade: string | null; classroom: { name: string } | null },
): string {
  if (g.scope === 'SCHOOL_STAFF') return 'گروه همکاران مدرسه'
  if (g.scope === 'SCHOOL_ALL') return 'گروه عمومی مدرسه'
  if (g.scope === 'GRADE') return `گروه پایه ${g.grade ?? ''}`.trim()
  if (g.scope === 'CUSTOM') return 'گروه سفارشی مدرسه'
  return g.classroom?.name ?? ''
}

/** برچسب دامنهٔ گروه برای پنل‌های مدیریتی */
export function scopeLabel(scope: string, grade?: string | null): string {
  switch (scope) {
    case 'SCHOOL_STAFF':
      return 'گروه همکاران'
    case 'SCHOOL_ALL':
      return 'گروه عمومی'
    case 'GRADE':
      return `گروه پایه ${grade ?? ''}`.trim()
    case 'CUSTOM':
      return 'گروه سفارشی'
    default:
      return 'گروه درسی'
  }
}

export async function getSchoolFeatures(
  schoolId: string,
): Promise<SchoolFeatures> {
  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { features: true, isActive: true },
  })
  if (!school || !school.isActive) {
    return { ...parseFeatures(null), chat: false, dm: false }
  }
  return parseFeatures(school.features)
}

/** آیا دانش‌آموز عضو «مؤثر» گروه درسی کلاس است؟ (ثبت‌نام کلاس − استثنا + افزودنی‌ها) */
export async function isEffectiveStudentMember(
  groupId: string,
  classroomId: string,
  studentId: string,
): Promise<boolean> {
  const override = await db.groupMemberOverride.findUnique({
    where: {
      subjectGroupId_userId: { subjectGroupId: groupId, userId: studentId },
    },
  })
  if (override?.action === 'REMOVE') return false
  if (override?.action === 'ADD') return true
  const enrolled = await db.classroomEnrollment.findFirst({
    where: { studentId, classroomId },
  })
  return !!enrolled
}

/**
 * عضویت خودکار در گروه‌های عمومی مدرسه (scope != CLASS):
 * - SCHOOL_STAFF: همه معلمان + معاونان + مدیر مدرسه
 * - SCHOOL_ALL: همه دانش‌آموزان + معلمان + معاونان + مدیر مدرسه
 * - GRADE: دانش‌آموزان کلاس‌های آن پایه + معلمان همان پایه + مدیر مدرسه
 * - CUSTOM (گروه سفارشی): هیچ عضو خودکاری ندارد — فقط افرادی که مدیر انتخاب کرده
 *   (استثنای ADD) + مدیر مدرسه (نظارت)
 * نسخه کاربرمحور — برای نشست فعلی و فهرست‌سازی اعضا هر دو استفاده می‌شود.
 */
export async function schoolGroupAutoMember(
  g: {
    id: string
    scope: string
    grade: string | null
    classroom: { schoolId: string } | null
    schoolId: string | null
  },
  user: { id: string; role: string; schoolId: string | null },
): Promise<boolean> {
  if (g.scope === 'CLASS') return false
  const schoolId = groupSchoolId(g)
  if (!schoolId || schoolId !== user.schoolId) return false

  if (user.role === 'SCHOOL_ADMIN') return true
  if (g.scope === 'CUSTOM') return false
  if (user.role === 'SCHOOL_VICE') return g.scope === 'SCHOOL_STAFF' || g.scope === 'SCHOOL_ALL'
  if (g.scope === 'SCHOOL_STAFF') return user.role === 'TEACHER'
  if (g.scope === 'SCHOOL_ALL') {
    return user.role === 'TEACHER' || user.role === 'STUDENT'
  }
  if (g.scope === 'GRADE' && g.grade) {
    if (user.role === 'STUDENT') {
      const enr = await db.classroomEnrollment.findFirst({
        where: {
          studentId: user.id,
          classroom: { schoolId, grade: g.grade },
        },
        select: { id: true },
      })
      return !!enr
    }
    if (user.role === 'TEACHER') {
      const t = await db.teachingAssignment.findFirst({
        where: {
          teacherId: user.id,
          subjectGroup: { classroom: { schoolId, grade: g.grade } },
        },
        select: { id: true },
      })
      return !!t
    }
  }
  return false
}

export async function isSchoolGroupMember(
  g: {
    id: string
    scope: string
    grade: string | null
    classroom: { schoolId: string } | null
    schoolId: string | null
  },
  session: SessionPayload,
): Promise<boolean> {
  return schoolGroupAutoMember(g, { id: session.uid, role: session.role, schoolId: session.schoolId })
}

/**
 * عضویت «مؤثر» گروه عمومی مدرسه = عضویت خودکار یا افزوده‌شده توسط مدیر/معلم،
 * منهای کاربرانی که مدیر از گروه حذف کرده است — پایه مدیریت اعضا از هدر گروه.
 */
export async function isEffectiveSchoolGroupMember(
  g: {
    id: string
    scope: string
    grade: string | null
    classroom: { schoolId: string } | null
    schoolId: string | null
  },
  user: { id: string; role: string; schoolId: string | null },
): Promise<boolean> {
  if (g.scope === 'CLASS') return false
  const override = await db.groupMemberOverride.findUnique({
    where: { subjectGroupId_userId: { subjectGroupId: g.id, userId: user.id } },
  })
  if (override?.action === 'REMOVE') return false
  if (override?.action === 'ADD') {
    // افزوده‌شدن فقط در دامنه مدرسه خود معنا دارد
    return groupSchoolId(g) === user.schoolId
  }
  return schoolGroupAutoMember(g, user)
}

/** دسترسی مشاهده گروه بر اساس نقش و عضویت واقعی (گروه کلاسی و عمومی) */
export async function getAccessibleGroup(
  session: SessionPayload,
  groupId: string,
): Promise<GroupWithContext | null> {
  const group = await getGroupById(groupId)
  if (!group) return null

  if (group.scope === 'CLASS') {
    if (!group.classroom) return null
    // مدیر و معاون مدرسه: همهٔ گروه‌های کلاسی مدرسه خودشان (معاون = دسترسی کامل مدیر)
    if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') {
      return group.classroom.schoolId === session.schoolId ? group : null
    }
    if (session.role === 'TEACHER') {
      const assigned = await db.teachingAssignment.findFirst({
        where: { teacherId: session.uid, subjectGroupId: groupId },
      })
      return assigned ? group : null
    }
    if (session.role === 'STUDENT') {
      const member = await isEffectiveStudentMember(
        groupId,
        group.classroom.id,
        session.uid,
      )
      return member ? group : null
    }
    return null
  }

  // گروه‌های عمومی مدرسه — عضویت مؤثر (خودکار ± استثناهای مدیر/معلم)
  return (await isEffectiveSchoolGroupMember(group, { id: session.uid, role: session.role, schoolId: session.schoolId }))
    ? group
    : null
}

/** آیا کاربر می‌تواند در گروه پیام بفرستد؟ (سیاست + بایگانی + عضویت) */
export async function checkGroupSendPermission(
  session: SessionPayload,
  group: GroupWithContext,
): Promise<{ ok: boolean; reason?: string }> {
  const features = await getSchoolFeatures(groupSchoolId(group) ?? '')
  if (!features.chat) {
    return { ok: false, reason: 'پیام‌رسانی گروهی برای این مدرسه غیرفعال است' }
  }
  if (group.archivedAt) {
    return {
      ok: false,
      reason: 'این گروه بایگانی شده است و فقط قابل مشاهده است',
    }
  }

  // قفل مدیر برای دانش‌آموزان — گروه مخفی نمی‌شود و مشاهده آزاد است؛
  // فقط ارسال پیام/فایل دانش‌آموز بسته است (معلم/مدیر/معاون بی‌تأثیر)
  if (group.lockedForStudents && session.role === 'STUDENT') {
    return {
      ok: false,
      reason: 'این گروه توسط مدیر برای دانش‌آموزان قفل شده است؛ فقط می‌توانید پیام‌ها را ببینید',
    }
  }

  const policy = group.messagePolicy
  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') {
    return groupSchoolId(group) === session.schoolId
      ? { ok: true }
      : { ok: false, reason: 'دسترسی غیرمجاز' }
  }
  if (policy === 'ADMINS') {
    return { ok: false, reason: 'ارسال پیام در این گروه فقط برای مدیر مدرسه مجاز است' }
  }

  if (group.scope !== 'CLASS') {
    // گروه‌های عمومی/سفارشی: دسترسی مشاهده (عضویت) قبلاً تأیید شده؛
    // اینجا فقط سیاست ارسال اعمال می‌شود
    if (policy === 'STAFF') {
      return session.role === 'TEACHER'
        ? { ok: true }
        : {
            ok: false,
            reason: 'ارسال پیام در این گروه فقط برای معلمان و مدیر مجاز است',
          }
    }
    return { ok: true }
  }

  if (!group.classroom) return { ok: false, reason: 'دسترسی غیرمجاز' }

  if (session.role === 'TEACHER') {
    const assigned = await db.teachingAssignment.findFirst({
      where: { teacherId: session.uid, subjectGroupId: group.id },
    })
    return assigned
      ? { ok: true }
      : { ok: false, reason: 'شما به این گروه اختصاص نیافته‌اید' }
  }

  if (session.role === 'STUDENT') {
    if (policy !== 'ALL') {
      return { ok: false, reason: 'ارسال پیام در این گروه برای دانش‌آموزان مجاز نیست' }
    }
    const member = await isEffectiveStudentMember(
      group.id,
      group.classroom.id,
      session.uid,
    )
    return member
      ? { ok: true }
      : { ok: false, reason: 'شما عضو این گروه نیستید' }
  }

  return { ok: false, reason: 'دسترسی غیرمجاز' }
}

/** شناسه همه گروه‌های قابل دسترس کاربر (کلاسی + عمومی + بایگانی‌شده‌ها برای تاریخچه) */
export async function listAccessibleGroupIds(
  session: SessionPayload,
): Promise<string[]> {
  // مدیر و معاون مدرسه: همهٔ گروه‌های مدرسه (معاون = دسترسی کامل مدیر)
  if ((session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') && session.schoolId) {
    const groups = await db.subjectGroup.findMany({
      where: {
        OR: [{ classroom: { schoolId: session.schoolId } }, { schoolId: session.schoolId }],
      },
      select: { id: true },
    })
    return groups.map((g) => g.id)
  }
  if (session.role === 'TEACHER') {
    const rows = await db.teachingAssignment.findMany({
      where: { teacherId: session.uid },
      select: { subjectGroupId: true },
    })
    const ids = [...new Set(rows.map((r) => r.subjectGroupId))]
    if (session.schoolId) {
      // گروه‌های عمومی: همکاران/عمومی + پایه‌هایی که در آن‌ها تدریس می‌کند
      const grades = (
        await db.teachingAssignment.findMany({
          where: { teacherId: session.uid, subjectGroup: { classroom: { schoolId: session.schoolId } } },
          select: { subjectGroup: { select: { classroom: { select: { grade: true } } } } },
        })
      )
        .map((r) => r.subjectGroup.classroom?.grade)
        .filter((g): g is string => !!g)
      const gset = [...new Set(grades)]
      const schoolGroups = await db.subjectGroup.findMany({
        where: {
          schoolId: session.schoolId,
          archivedAt: null,
          OR: [
            { scope: { in: ['SCHOOL_STAFF', 'SCHOOL_ALL'] } },
            { scope: 'GRADE', grade: { in: gset } },
          ],
        },
        select: { id: true },
      })
      ids.push(...schoolGroups.map((g) => g.id))
      // استثناهای عضویت گروه‌های عمومی: حذف‌شده‌ها بیرون، افزوده‌شده‌ها داخل
      const myOverrides = await db.groupMemberOverride.findMany({
        where: { userId: session.uid },
        select: { subjectGroupId: true, action: true, subjectGroup: { select: { schoolId: true, scope: true } } },
      })
      for (const o of myOverrides) {
        if (o.subjectGroup.scope === 'CLASS') continue
        if (o.subjectGroup.schoolId !== session.schoolId) continue
        if (o.action === 'REMOVE') {
          const idx = ids.indexOf(o.subjectGroupId)
          if (idx >= 0) ids.splice(idx, 1)
        } else {
          ids.push(o.subjectGroupId)
        }
      }
    }
    return [...new Set(ids)]
  }
  if (session.role === 'STUDENT') {
    // دانش‌آموز بدون مدرسه (حساب ناقص) هیچ گروهی ندارد
    if (!session.schoolId) return []
    const groups = await db.subjectGroup.findMany({
      where: {
        classroom: {
          schoolId: session.schoolId,
          enrollments: { some: { studentId: session.uid } },
        },
      },
      select: { id: true },
    })
    const added = await db.groupMemberOverride.findMany({
      where: { userId: session.uid, action: 'ADD' },
      select: { subjectGroupId: true },
    })
    const removed = new Set(
      (
        await db.groupMemberOverride.findMany({
          where: { userId: session.uid, action: 'REMOVE' },
          select: { subjectGroupId: true },
        })
      ).map((r) => r.subjectGroupId),
    )
    const ids = [
      ...new Set([
        ...groups.map((g) => g.id).filter((id) => !removed.has(id)),
        ...added.map((r) => r.subjectGroupId),
      ]),
    ]
    // گروه‌های عمومی: عمومی + پایهٔ کلاس‌های خودش
    const myGrades = (
      await db.classroomEnrollment.findMany({
        where: { studentId: session.uid, classroom: { schoolId: session.schoolId } },
        select: { classroom: { select: { grade: true } } },
      })
    )
      .map((e) => e.classroom.grade)
      .filter((g): g is string => !!g)
    const schoolGroups = await db.subjectGroup.findMany({
      where: {
        schoolId: session.schoolId,
        archivedAt: null,
        OR: [
          { scope: 'SCHOOL_ALL' },
          { scope: 'GRADE', grade: { in: [...new Set(myGrades)] } },
        ],
      },
      select: { id: true },
    })
    ids.push(...schoolGroups.map((g) => g.id))
    // استثناهای عضویت گروه‌های عمومی (افزوده‌شده توسط مدیر/معلم یا حذف‌شده)
    const myOverrides = await db.groupMemberOverride.findMany({
      where: { userId: session.uid },
      select: { subjectGroupId: true, action: true, subjectGroup: { select: { schoolId: true, scope: true } } },
    })
    for (const o of myOverrides) {
      if (o.subjectGroup.scope === 'CLASS') continue
      if (o.subjectGroup.schoolId !== session.schoolId) continue
      if (o.action === 'REMOVE') {
        const idx = ids.indexOf(o.subjectGroupId)
        if (idx >= 0) ids.splice(idx, 1)
      } else {
        ids.push(o.subjectGroupId)
      }
    }
    return [...new Set(ids)]
  }
  return []
}

/**
 * ماتریس گفتگوی خصوصی:
 * - مدیر مدرسه با همه کاربران مدرسه خودش
 * - معلم با مدیر مدرسه و دانش‌آموزان گروه‌های اختصاص‌یافته به خودش
 * - دانش‌آموز با مدیر مدرسه و معلمان گروه‌های خودش
 * - دانش‌آموز با دانش‌آموز: فقط هم‌کلاسی و فقط در صورت فعال‌سازی مدیر مدرسه
 * - بین کاربران مدارس مختلف هرگز
 */
export async function canDirectMessage(
  session: SessionPayload,
  otherUserId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!session.schoolId) return { ok: false, reason: 'دسترسی غیرمجاز' }

  const other = await db.user.findFirst({
    where: {
      id: otherUserId,
      isActive: true,
      role: { in: ['SCHOOL_ADMIN', 'SCHOOL_VICE', 'TEACHER', 'STUDENT'] },
    },
    select: { id: true, role: true, schoolId: true },
  })
  if (!other || other.id === session.uid) {
    return { ok: false, reason: 'گفتگوی خصوصی با این کاربر امکان‌پذیر نیست' }
  }
  if (other.schoolId !== session.schoolId) {
    return { ok: false, reason: 'گفتگو بین کاربران مدارس مختلف مجاز نیست' }
  }

  if (session.role === 'SCHOOL_ADMIN') {
    return { ok: true }
  }

  // معاون مدرسه — عضو ستاد مدرسه: با همه کاربران مدرسه خود می‌تواند گفتگو کند
  if (session.role === 'SCHOOL_VICE') {
    return { ok: true }
  }

  const features = await getSchoolFeatures(session.schoolId)
  if (!features.dm) {
    return { ok: false, reason: 'پیام خصوصی برای این مدرسه غیرفعال است' }
  }

  // بررسی اشتراک گروه بین معلم و دانش‌آموز
  const shareGroup = async (teacherId: string, studentId: string) => {
    const assignments = await db.teachingAssignment.findMany({
      where: { teacherId },
      select: { subjectGroupId: true },
    })
    for (const a of assignments) {
      const group = await getGroupById(a.subjectGroupId)
      if (!group || !group.classroom) continue
      if (
        await isEffectiveStudentMember(group.id, group.classroom.id, studentId)
      ) {
        return true
      }
    }
    return false
  }

  if (session.role === 'TEACHER') {
    if (other.role === 'SCHOOL_ADMIN' || other.role === 'SCHOOL_VICE') return { ok: true }
    if (other.role === 'STUDENT') {
      const shared = await shareGroup(session.uid, other.id)
      return shared
        ? { ok: true }
        : {
            ok: false,
            reason:
              'معلم فقط با دانش‌آموزان گروه‌های درسی خودش می‌تواند گفتگو کند',
          }
    }
    return {
      ok: false,
      reason: 'معلم فقط با مدیر مدرسه و دانش‌آموزان گروه‌های خودش گفتگو می‌کند',
    }
  }

  if (session.role === 'STUDENT') {
    if (other.role === 'SCHOOL_ADMIN' || other.role === 'SCHOOL_VICE') return { ok: true }
    if (other.role === 'TEACHER') {
      const shared = await shareGroup(other.id, session.uid)
      return shared
        ? { ok: true }
        : { ok: false, reason: 'این معلم به گروه‌های شما اختصاص ندارد' }
    }
    if (other.role === 'STUDENT') {
      const me = await db.user.findUnique({
        where: { id: session.uid },
        select: { enrollments: { select: { classroomId: true } } },
      })
      const myClassIds = me?.enrollments.map((e) => e.classroomId) ?? []
      const otherClassIds = (
        await db.classroomEnrollment.findMany({
          where: { studentId: other.id, classroom: { schoolId: session.schoolId } },
          select: { classroomId: true },
        })
      ).map((e) => e.classroomId)
      const common = myClassIds.filter((id) => otherClassIds.includes(id))
      if (common.length === 0) {
        return { ok: false, reason: 'گفتگوی خصوصی فقط بین هم‌کلاسی‌ها ممکن است' }
      }
      const classroom = await db.classroom.findFirst({
        where: { id: common[0] },
        select: { allowStudentDm: true },
      })
      if (!classroom?.allowStudentDm) {
        return {
          ok: false,
          reason: 'گفتگوی خصوصی بین دانش‌آموزان توسط مدیر مدرسه فعال نشده است',
        }
      }
      return { ok: true }
    }
  }

  return { ok: false, reason: 'دسترسی غیرمجاز' }
}

/** برچسب فارسی نقش */
export function roleLabel(role: string): string {
  switch (role) {
    case 'SCHOOL_ADMIN':
      return 'مدیر مدرسه'
    case 'SCHOOL_VICE':
      return 'معاون مدرسه'
    case 'TEACHER':
      return 'معلم'
    case 'STUDENT':
      return 'دانش‌آموز'
    default:
      return ''
  }
}
