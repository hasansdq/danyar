import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import {
  createUserAccount,
  normalizeNationalId,
  parseRoleToken,
  type CreatableRole,
} from '@/lib/user-admin'
import { vicePermissionDenied } from '@/lib/vice-permissions'

/** لیست معلم‌ها و دانش‌آموزان مدرسه با جست‌وجو و صفحه‌بندی — مدیر و معاون (مشاهده) */
export async function GET(req: NextRequest) {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const roleParam = sp.get('role')
  const roles =
    roleParam === 'TEACHER' || roleParam === 'STUDENT' || roleParam === 'SCHOOL_VICE'
      ? [roleParam]
      : ['TEACHER', 'SCHOOL_VICE', 'STUDENT']
  // بدون صفحه‌بندی (برای دیالوگ‌های انتخاب) یا با صفحه‌بندی
  const pageParam = sp.get('page')
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get('pageSize') ?? '20') || 20))
  const page = Math.max(1, parseInt(pageParam ?? '1') || 1)

  const where: Record<string, unknown> = {
    schoolId: res.session.schoolId,
    role: { in: roles },
  }
  if (q) {
    where.OR = [{ fullName: { contains: q } }, { username: { contains: q } }]
  }

  if (!pageParam) {
    // حالت بدون صفحه‌بندی: همه نتایج (سازگاری با دیالوگ‌های انتساب)
    const users = await db.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        fullName: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        phone: true,
        createdAt: true,
        enrollments: { select: { classroom: { select: { id: true, name: true, grade: true } } } },
        teachingAssignments: {
          select: {
            subjectGroup: { select: { id: true, name: true, classroom: { select: { name: true } } } },
          },
        },
        // درس‌های منتسب به معلم (درخواست کاربر — نمایش و ویرایش در دیالوگ کاربر)
        teacherLessons: {
          select: { lesson: { select: { id: true, name: true } } },
        },
        // استثناهای عضویت گروه دانش‌آموز (برای ویرایش کلاس‌ها و گروه‌ها)
        groupMemberOverrides: { select: { subjectGroupId: true, action: true } },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
    })
    return NextResponse.json({ users, total: users.length })
  }

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        fullName: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        phone: true,
        createdAt: true,
        enrollments: { select: { classroom: { select: { id: true, name: true, grade: true } } } },
        teachingAssignments: {
          select: {
            subjectGroup: { select: { id: true, name: true, classroom: { select: { name: true } } } },
          },
        },
        // درس‌های منتسب به معلم (درخواست کاربر — نمایش و ویرایش در دیالوگ کاربر)
        teacherLessons: {
          select: { lesson: { select: { id: true, name: true } } },
        },
        // استثناهای عضویت گروه دانش‌آموز (برای ویرایش کلاس‌ها و گروه‌ها)
        groupMemberOverrides: { select: { subjectGroupId: true, action: true } },
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return NextResponse.json({ users, total, page, pageSize })
}

/**
 * ایجاد حساب تکی (درخواست کاربر):
 * فیلدها: نام، نام خانوادگی، نقش، کدملی، شماره تماس (اختیاری)، کلاس (دانش‌آموز)، گروه‌های درسی (اختیاری)
 * نام کاربری = کدملی؛ رمز عبور پیش‌فرض = 123456
 * معاون: ثبت‌نام معلم/دانش‌آموز فقط با مجوز مربوطه؛ ایجاد معاون فقط توسط مدیر مدرسه
 */
export async function POST(req: NextRequest) {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const role: CreatableRole | null = parseRoleToken(body?.role)
  if (!role || role === 'SCHOOL_ADMIN') {
    return jsonError('نقش باید معلم، معاون یا دانش‌آموز باشد')
  }

  // ایجاد معاون فقط توسط خود مدیر مدرسه (معاون، معاون نمی‌سازد)
  if (role === 'SCHOOL_VICE' && res.session.role === 'SCHOOL_VICE') {
    return jsonError('ایجاد حساب معاون فقط توسط مدیر مدرسه انجام می‌شود', 403)
  }
  // ثبت‌نام معلم/دانش‌آموز — قابل محدودیت برای معاون (سوییچ مدیر)
  if (res.session.role === 'SCHOOL_VICE') {
    const perm = role === 'TEACHER' ? 'register_teachers' : 'register_students'
    const denied = await vicePermissionDenied(res.session, perm)
    if (denied) return denied
  }

  // گروه‌های درسی معلم/معاون اختیاری است (درخواست کاربر) — بعداً از ویرایش کاربر یا
  // مدیریت گروه‌ها هم قابل انتساب است؛ معاون لزوماً درس تدریس نمی‌کند
  let subjectGroupIds: string[] = []
  if (role === 'TEACHER' || role === 'SCHOOL_VICE') {
    const rawIds: unknown[] = Array.isArray(body?.subjectGroupIds) ? body.subjectGroupIds : []
    subjectGroupIds = [...new Set(rawIds.map((v) => String(v)))]
  }

  // درس‌های منتسب به معلم — فیلد چندانتخابی فرم ایجاد معلم (درخواست کاربر)
  let lessonIds: string[] = []
  if (role === 'TEACHER' || role === 'SCHOOL_VICE') {
    const rawLessonIds: unknown[] = Array.isArray(body?.lessonIds) ? body.lessonIds : []
    lessonIds = [...new Set(rawLessonIds.map((v) => String(v)).filter(Boolean))]
  }

  const nationalId = normalizeNationalId(body?.nationalId ?? body?.username)
  if (!nationalId) return jsonError('کدملی باید فقط عدد باشد (کدملی استاندارد ۱۰ رقم است)')

  const result = await createUserAccount({
    schoolId: res.session.schoolId,
    role,
    firstName: String(body?.firstName ?? ''),
    lastName: String(body?.lastName ?? ''),
    nationalId,
    phone: body?.phone ?? null,
    classroomId: body?.classroomId ?? null,
    subjectGroupIds,
    lessonIds,
  })
  if (!result.ok) return jsonError(result.error, result.error.includes('قبلاً') ? 409 : 400)

  return NextResponse.json({ user: result.user }, { status: 201 })
}
