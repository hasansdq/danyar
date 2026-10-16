import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import {
  getAccessibleGroup,
  groupSchoolId,
  groupSubtitle,
  schoolGroupAutoMember,
  isEffectiveSchoolGroupMember,
} from '@/lib/chat-access'
import { notifySocket } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

interface MemberDto {
  id: string
  fullName: string
  role: string
  label: string
  avatarUrl: string | null
  /** آیا کاربر فعلی می‌تواند با این عضو گفتگوی خصوصی باز کند؟ (ماتریس canDirectMessage) */
  canDm: boolean
  /** AUTO = عضویت خودکار/ثبت‌نامی، ADDED = افزوده‌شده توسط مدیر/معلم */
  status?: 'AUTO' | 'ADDED'
}

function roleLabel(role: string): string {
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

function avatarOf(avatarKey: string | null, userId: string): string | null {
  return avatarKey ? `/api/users/${userId}/avatar` : null
}

/** مجوز ویرایش اعضا — معلم: فقط دانش‌آموزان؛ مدیر مدرسه: دانش‌آموزان و معلمان */
function editPermissions(role: string) {
  return {
    canEditStudents: role === 'SCHOOL_ADMIN' || role === 'TEACHER',
    canEditTeachers: role === 'SCHOOL_ADMIN',
  }
}

/**
 * فهرست اعضای گروه برای هدر گفتگو (همه نقش‌ها):
 * - گروه درسی کلاس: معلمان منتسب، دانش‌آموزان عضو مؤثر و مدیریت مدرسه
 * - گروه‌های عمومی مدرسه: اعضای خودکار ± استثناهای مدیر/معلم (افزوده/حذف‌شده)
 * canDm هر عضو با ماتریس گفتگوی خصوصی همخوان است — گزینه‌های بدون پشتوانهٔ
 * ماتریس غیرفعال می‌شوند تا دکمهٔ خراب دیده نشود.
 * canEditStudents/canEditTeachers: پایه دکمه‌های حذف/افزودن در همین دیالوگ.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const group = await getAccessibleGroup(session, id)
  if (!group) return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)

  const subtitle = groupSubtitle(group)
  const isStudentViewer = session.role === 'STUDENT'
  const isSchoolGroup = group.scope !== 'CLASS'
  const canManage = isSchoolGroup
    ? session.role === 'SCHOOL_ADMIN'
    : session.role === 'SCHOOL_ADMIN' || session.role === 'TEACHER'
  const { canEditStudents, canEditTeachers } = editPermissions(session.role)

  // ── گروه‌های عمومی/سفارشی مدرسه ──
  if (isSchoolGroup) {
    const schoolId = groupSchoolId(group)
    if (!schoolId) return jsonError('گروه یافت نشد', 404)

    const isCustom = group.scope === 'CUSTOM'
    const wantsStudents =
      !isCustom &&
      (group.scope === 'SCHOOL_ALL' || (group.scope === 'GRADE' && !!group.grade))
    const gradeClause =
      group.scope === 'GRADE' && group.grade
        ? { schoolId, grade: group.grade }
        : { schoolId }

    const [students, teachers, admins, overrides] = await Promise.all([
      wantsStudents
        ? group.scope === 'GRADE'
          ? db.classroomEnrollment.findMany({
              where: { classroom: gradeClause, student: { isActive: true } },
              select: {
                student: { select: { id: true, fullName: true, role: true, avatarKey: true } },
              },
            })
          : db.user.findMany({
              where: { schoolId, role: 'STUDENT', isActive: true },
              select: { id: true, fullName: true, role: true, avatarKey: true },
            }).then((rows) => rows.map((u) => ({ student: u })))
        : Promise.resolve([] as { student: { id: string; fullName: string; role: string; avatarKey: string | null } }[]),
      group.scope === 'GRADE'
        ? db.teachingAssignment.findMany({
            where: { subjectGroup: { classroom: gradeClause }, teacher: { isActive: true } },
            select: {
              teacher: { select: { id: true, fullName: true, role: true, avatarKey: true } },
            },
          })
        : isCustom
          // گروه سفارشی هیچ عضو خودکاری ندارد — حتی معلمان
          ? Promise.resolve([] as { teacher: { id: string; fullName: string; role: string; avatarKey: string | null } }[])
          : db.user
              .findMany({
                where: { schoolId, role: { in: ['TEACHER', 'SCHOOL_VICE'] }, isActive: true },
                select: { id: true, fullName: true, role: true, avatarKey: true },
              })
              .then((rows) => rows.map((u) => ({ teacher: u }))),
      db.user.findMany({
        where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
        select: { id: true, fullName: true, role: true, avatarKey: true },
        orderBy: { fullName: 'asc' },
      }),
      db.groupMemberOverride.findMany({
        where: { subjectGroupId: id },
        include: {
          user: { select: { id: true, fullName: true, role: true, avatarKey: true, isActive: true } },
        },
      }),
    ])

    const removed = new Set(
      overrides.filter((o) => o.action === 'REMOVE').map((o) => o.userId),
    )
    const addedOverrides = overrides.filter((o) => o.action === 'ADD')

    const autoTeacherIds = new Set(teachers.map((t) => t.teacher.id))
    const teacherList: { id: string; fullName: string; role: string; avatarKey: string | null; status: 'AUTO' | 'ADDED' }[] =
      teachers
        .map((t) => t.teacher)
        .filter((t) => !removed.has(t.id))
        .map((t) => ({ ...t, status: 'AUTO' as const }))
    for (const o of addedOverrides) {
      if (o.user.role !== 'TEACHER' && o.user.role !== 'SCHOOL_VICE') continue
      if (!o.user.isActive) continue
      if (removed.has(o.user.id) || autoTeacherIds.has(o.user.id)) continue
      teacherList.push({ ...o.user, status: 'ADDED' })
    }

    const autoStudentIds = new Set(students.map((s) => s.student.id))
    const studentList: { id: string; fullName: string; role: string; avatarKey: string | null; status: 'AUTO' | 'ADDED' }[] =
      students
        .map((s) => s.student)
        .filter((s) => !removed.has(s.id))
        .map((s) => ({ ...s, status: 'AUTO' as const }))
    for (const o of addedOverrides) {
      if (o.user.role !== 'STUDENT' || !o.user.isActive) continue
      if (removed.has(o.user.id) || autoStudentIds.has(o.user.id)) continue
      studentList.push({ ...o.user, status: 'ADDED' })
    }

    // ماتریس DM در گروه‌های عمومی: مدیر با همه؛ معلم/معاون با ستاد؛
    // دانش‌آموز فقط با مدیریت مدرسه (مدیر/معاون)
    const dmFor = (role: string): boolean => {
      if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') return true
      if (session.role === 'TEACHER') return role !== 'STUDENT'
      return role === 'SCHOOL_ADMIN' || role === 'SCHOOL_VICE'
    }

    const teacherDtos: MemberDto[] = teacherList
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
      .map((t) => ({
        id: t.id,
        fullName: t.fullName,
        role: t.role,
        label: roleLabel(t.role),
        avatarUrl: avatarOf(t.avatarKey, t.id),
        canDm: dmFor(t.role) && t.id !== session.uid,
        status: t.status,
      }))

    const studentDtos: MemberDto[] = studentList
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
      .map((s) => ({
        id: s.id,
        fullName: s.fullName,
        role: s.role,
        label: roleLabel(s.role),
        avatarUrl: avatarOf(s.avatarKey, s.id),
        canDm: dmFor(s.role) && s.id !== session.uid,
        status: s.status,
      }))

    const adminDtos: MemberDto[] = admins
      .filter((a) => a.id !== session.uid)
      .map((a) => ({
        id: a.id,
        fullName: a.fullName,
        role: a.role,
        label: roleLabel(a.role),
        avatarUrl: avatarOf(a.avatarKey, a.id),
        canDm: true,
      }))

    return NextResponse.json({
      group: {
        id: group.id,
        name: group.name,
        className: subtitle,
        policy: group.messagePolicy,
        archived: !!group.archivedAt,
        avatarUrl: group.avatarKey
          ? `/api/groups/${group.id}/avatar?v=${group.avatarUpdatedAt?.getTime() ?? 0}`
          : null,
      },
      canManage,
      canEditStudents,
      canEditTeachers,
      canLock: canManage,
      studentDmAllowed: false,
      isStudentViewer,
      members: { teachers: teacherDtos, students: studentDtos, admins: adminDtos },
    })
  }

  // ── گروه درسی کلاس ──
  const classroomId = group.classroom?.id
  if (!classroomId) return jsonError('گروه یافت نشد', 404)

  const [assignments, enrolled, addOverrides, removeOverrides, admins, classroom] =
    await Promise.all([
      db.teachingAssignment.findMany({
        where: { subjectGroupId: id },
        select: { teacher: { select: { id: true, fullName: true, role: true, avatarKey: true, isActive: true } } },
      }),
      db.classroomEnrollment.findMany({
        where: { classroomId },
        select: { studentId: true, student: { select: { id: true, fullName: true, role: true, avatarKey: true, isActive: true } } },
      }),
      db.groupMemberOverride.findMany({
        where: { subjectGroupId: id, action: 'ADD' },
        select: { user: { select: { id: true, fullName: true, role: true, avatarKey: true, isActive: true } } },
      }),
      db.groupMemberOverride.findMany({
        where: { subjectGroupId: id, action: 'REMOVE' },
        select: { userId: true },
      }),
      db.user.findMany({
        where: { schoolId: group.classroom!.schoolId, role: 'SCHOOL_ADMIN', isActive: true },
        select: { id: true, fullName: true, role: true, avatarKey: true },
        orderBy: { fullName: 'asc' },
      }),
      db.classroom.findUnique({
        where: { id: classroomId },
        select: { allowStudentDm: true },
      }),
    ])

  // ── معلمان ──
  const teachers: MemberDto[] = assignments
    .map((a) => a.teacher)
    .filter((t) => t.isActive)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
    .map((t) => ({
      id: t.id,
      fullName: t.fullName,
      role: t.role,
      label: roleLabel(t.role),
      avatarUrl: avatarOf(t.avatarKey, t.id),
      // معلم/مدیر با معلمان گروه می‌تواند گفتگو کند؛ دانش‌آموز با معلمان گروه خودش
      canDm: session.role === 'SCHOOL_ADMIN' || session.role === 'TEACHER' || session.role === 'STUDENT',
      status: 'AUTO' as const,
    }))

  // ── دانش‌آموزان عضو مؤثر (ثبت‌نام کلاسی + افزودنی − حذفی) ──
  const removed = new Set(removeOverrides.map((r) => r.userId))
  const studentMap = new Map<string, { id: string; fullName: string; role: string; avatarKey: string | null; inClassroom: boolean; status: 'AUTO' | 'ADDED' }>()
  for (const e of enrolled) {
    if (!e.student.isActive || removed.has(e.studentId)) continue
    studentMap.set(e.studentId, { ...e.student, avatarKey: e.student.avatarKey, inClassroom: true, status: 'AUTO' })
  }
  for (const o of addOverrides) {
    if (!o.user.isActive || removed.has(o.user.id)) continue
    if (!studentMap.has(o.user.id)) {
      studentMap.set(o.user.id, { ...o.user, avatarKey: o.user.avatarKey, inClassroom: false, status: 'ADDED' })
    }
  }

  const studentDmAllowed = !!classroom?.allowStudentDm

  const students: MemberDto[] = [...studentMap.values()]
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fa'))
    .map((s) => ({
      id: s.id,
      fullName: s.fullName,
      role: s.role,
      label: roleLabel(s.role),
      avatarUrl: avatarOf(s.avatarKey, s.id),
      // دانش‌آموز → دانش‌آموز: فقط هم‌کلاسیِ ثبت‌نامی و فقط با مجوز مدیر (محدودیت گروه‌ها)
      canDm: isStudentViewer
        ? studentDmAllowed && s.inClassroom && s.id !== session.uid
        : true,
      status: s.status,
    }))

  // ── مدیریت مدرسه (مجاز به ارسال در همه گروه‌های مدرسه) ──
  const adminDtos: MemberDto[] = admins
    .filter((a) => a.id !== session.uid)
    .map((a) => ({
      id: a.id,
      fullName: a.fullName,
      role: a.role,
      label: roleLabel(a.role),
      avatarUrl: avatarOf(a.avatarKey, a.id),
      canDm: true,
    }))

  return NextResponse.json({
    group: {
      id: group.id,
      name: group.name,
      className: subtitle,
      policy: group.messagePolicy,
      archived: !!group.archivedAt,
      avatarUrl: group.avatarKey
        ? `/api/groups/${group.id}/avatar?v=${group.avatarUpdatedAt?.getTime() ?? 0}`
        : null,
    },
    canManage,
    canEditStudents,
    canEditTeachers,
    canLock: canManage && !(session.role === 'TEACHER' && group.messagePolicy === 'ADMINS'),
    studentDmAllowed,
    isStudentViewer,
    members: { teachers, students, admins: adminDtos },
  })
}

/**
 * PUT /api/chats/group/[id]/members — افزودن/حذف اعضا از هدر گروه
 *
 * مجوزها:
 * - معلم: فقط افزودن/حذف دانش‌آموز (گروه درسی منتسب به خودش یا گروه عمومی عضو آن)
 * - مدیر مدرسه: دانش‌آموزان و معلمان (در گروه درسی = انتساب/لغو انتساب معلم)
 * - مدیریت مدرسه هرگز حذف/افزوده نمی‌شود (عضویت دائمی)
 * پس از تغییر، اتاق‌های سوکت کاربران هدف بازسازی می‌شود.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'TEACHER') {
    return jsonError('فقط مدیر مدرسه و معلم می‌توانند اعضا را مدیریت کنند', 403)
  }

  const group = await getAccessibleGroup(session, id)
  if (!group) return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)
  if (group.archivedAt) {
    return jsonError('این گروه بایگانی شده است و اعضایش تغییر نمی‌کند', 400)
  }

  const body = await req.json().catch(() => null)
  const adds: string[] = Array.isArray(body?.adds) ? body.adds.map(String).filter(Boolean) : []
  const removes: string[] = Array.isArray(body?.removes) ? body.removes.map(String).filter(Boolean) : []
  if (adds.length === 0 && removes.length === 0) {
    return jsonError('هیچ کاربری برای افزودن/حذف مشخص نشده است')
  }

  const isSchoolGroup = group.scope !== 'CLASS'
  const schoolId = groupSchoolId(group)

  // معلمان فقط دانش‌آموزان را مدیریت می‌کنند
  const targets = [...adds, ...removes]
  const targetUsers = await db.user.findMany({
    where: { id: { in: targets }, isActive: true },
    select: { id: true, role: true, schoolId: true, fullName: true },
  })
  for (const uid of targets) {
    const u = targetUsers.find((t) => t.id === uid)
    if (!u || u.schoolId !== session.schoolId) {
      return jsonError('کاربر یافت نشد یا به مدرسه شما تعلق ندارد', 400)
    }
    if (u.role === 'SCHOOL_ADMIN') {
      return jsonError('مدیریت مدرسه عضو دائمی گروه است و تغییر نمی‌کند', 400)
    }
    if (u.role === 'TEACHER' && session.role !== 'SCHOOL_ADMIN') {
      return jsonError('افزودن یا حذف معلم فقط توسط مدیر مدرسه امکان‌پذیر است', 403)
    }
  }

  const affectedUserIds: string[] = []

  for (const uid of adds) {
    const u = targetUsers.find((t) => t.id === uid)!
    if (u.role === 'TEACHER') {
      // معلم — فقط مدیر مدرسه به اینجا می‌رسد
      if (isSchoolGroup) {
        // اگر عضو خودکار است، افزودن یعنی پاک‌کردن استثنای حذف — نه ایجاد ADD
        const auto = await schoolGroupAutoMember(group, { id: uid, role: u.role, schoolId: u.schoolId })
        if (auto) {
          await db.groupMemberOverride.deleteMany({
            where: { subjectGroupId: id, userId: uid },
          })
        } else {
          await db.groupMemberOverride.upsert({
            where: { subjectGroupId_userId: { subjectGroupId: id, userId: uid } },
            create: { subjectGroupId: id, userId: uid, action: 'ADD' },
            update: { action: 'ADD' },
          })
        }
        affectedUserIds.push(uid)
      } else {
        // گروه درسی: انتساب واقعی معلم (مبنای دسترسی/ارجاع در بقیه سامانه)
        const dup = await db.teachingAssignment.findFirst({
          where: { teacherId: uid, subjectGroupId: id },
        })
        if (!dup) {
          await db.teachingAssignment.create({ data: { teacherId: uid, subjectGroupId: id } })
          affectedUserIds.push(uid)
        }
      }
      continue
    }
    // دانش‌آموز
    if (isSchoolGroup) {
      // عضو خودکار (مثلاً دانش‌آموز همان پایه) → افزودن = حذف استثنای حذف
      const auto = await schoolGroupAutoMember(group, { id: uid, role: u.role, schoolId: u.schoolId })
      if (auto) {
        await db.groupMemberOverride.deleteMany({
          where: { subjectGroupId: id, userId: uid },
        })
      } else {
        await db.groupMemberOverride.upsert({
          where: { subjectGroupId_userId: { subjectGroupId: id, userId: uid } },
          create: { subjectGroupId: id, userId: uid, action: 'ADD' },
          update: { action: 'ADD' },
        })
      }
    } else {
      // گروه درسی: اگر ثبت‌نام کلاس دارد، افزودن یعنی پاک‌کردن استثنا (بازگشت به عضویت خودکار)؛
      // وگرنه استثنای ADD ثبت می‌شود
      const enrolled = await db.classroomEnrollment.findFirst({
        where: { studentId: uid, classroomId: group.classroom!.id },
      })
      if (enrolled) {
        await db.groupMemberOverride.deleteMany({
          where: { subjectGroupId: id, userId: uid },
        })
      } else {
        await db.groupMemberOverride.upsert({
          where: { subjectGroupId_userId: { subjectGroupId: id, userId: uid } },
          create: { subjectGroupId: id, userId: uid, action: 'ADD' },
          update: { action: 'ADD' },
        })
      }
    }
    affectedUserIds.push(uid)
  }

  for (const uid of removes) {
    const u = targetUsers.find((t) => t.id === uid)!
    if (u.role === 'TEACHER') {
      if (isSchoolGroup) {
        // عضویت خودکار دارد؟ (مثلاً معلم همان پایه در گروه پایه) → استثنای حذف
        const auto = await schoolGroupAutoMember(group, { id: uid, role: u.role, schoolId: u.schoolId })
        if (auto) {
          await db.groupMemberOverride.upsert({
            where: { subjectGroupId_userId: { subjectGroupId: id, userId: uid } },
            create: { subjectGroupId: id, userId: uid, action: 'REMOVE' },
            update: { action: 'REMOVE' },
          })
        } else {
          // افزوده‌شده بود → حذف رکورد استثنا
          await db.groupMemberOverride.deleteMany({
            where: { subjectGroupId: id, userId: uid },
          })
        }
        affectedUserIds.push(uid)
      } else {
        // گروه درسی: لغو انتساب معلم
        const assignment = await db.teachingAssignment.findFirst({
          where: { teacherId: uid, subjectGroupId: id },
        })
        if (assignment) {
          await db.teachingAssignment.delete({ where: { id: assignment.id } })
          affectedUserIds.push(uid)
        }
      }
      continue
    }
    // دانش‌آموز
    if (isSchoolGroup) {
      const auto = await schoolGroupAutoMember(group, { id: uid, role: u.role, schoolId: u.schoolId })
      if (auto) {
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
      affectedUserIds.push(uid)
    } else {
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
      affectedUserIds.push(uid)
    }
  }

  // اتاق‌های سوکت کاربران تغییرکرده بازسازی شود (عضویت زنده به‌روز است)
  if (affectedUserIds.length) {
    await notifySocket({ refreshUserIds: [...new Set(affectedUserIds)] })
  }

  return NextResponse.json({
    ok: true,
    changed: affectedUserIds.length,
  })
}

/**
 * GET /api/chats/group/[id]/members?candidates=1&q=&role= — جست‌وجوی افراد قابل افزودن
 * (به‌جای مسیر جدا، همان مسیر با پارامتر candidates — دسترسی همگام با PUT)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'TEACHER') {
    return jsonError('فقط مدیر مدرسه و معلم می‌توانند اعضا را جست‌وجو کنند', 403)
  }

  const group = await getAccessibleGroup(session, id)
  if (!group) return jsonError('گروه یافت نشد یا دسترسی ندارید', 404)

  const body = await req.json().catch(() => null)
  const q = String(body?.q ?? '').trim()
  const wantRole = body?.role === 'TEACHER' ? 'TEACHER' : 'STUDENT'
  const { canEditStudents, canEditTeachers } = editPermissions(session.role)
  if (wantRole === 'TEACHER' && !canEditTeachers) {
    return jsonError('افزودن معلم فقط توسط مدیر مدرسه امکان‌پذیر است', 403)
  }
  if (wantRole === 'STUDENT' && !canEditStudents) {
    return jsonError('دسترسی غیرمجاز', 403)
  }

  const where = {
    schoolId: session.schoolId,
    role: wantRole === 'TEACHER' ? { in: ['TEACHER', 'SCHOOL_VICE'] } : 'STUDENT',
    isActive: true,
    ...(q ? { OR: [{ fullName: { contains: q } }, { username: { contains: q } }] } : {}),
  }

  const users = await db.user.findMany({
    where,
    select: { id: true, fullName: true, role: true, avatarKey: true },
    orderBy: { fullName: 'asc' },
    take: 40,
  })

  // فقط افرادِ غیرعضوِ مؤثر برگردند
  const effective: string[] = []
  for (const u of users) {
    if (group.scope === 'CLASS') {
      if (u.role === 'STUDENT') {
        const enrolled = await db.classroomEnrollment.findFirst({
          where: { studentId: u.id, classroomId: group.classroom!.id },
        })
        const override = await db.groupMemberOverride.findUnique({
          where: { subjectGroupId_userId: { subjectGroupId: id, userId: u.id } },
        })
        if (override?.action === 'REMOVE') continue
        if (override?.action === 'ADD' || enrolled) effective.push(u.id)
      } else {
        const assigned = await db.teachingAssignment.findFirst({
          where: { teacherId: u.id, subjectGroupId: id },
        })
        if (assigned) effective.push(u.id)
      }
    } else {
      const member = await isEffectiveSchoolGroupMember(group, {
        id: u.id,
        role: u.role,
        schoolId: session.schoolId,
      })
      if (member) effective.push(u.id)
    }
  }

  const out = users
    .filter((u) => !effective.includes(u.id))
    .slice(0, 20)
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      label: roleLabel(u.role),
    }))

  return NextResponse.json({ candidates: out })
}
