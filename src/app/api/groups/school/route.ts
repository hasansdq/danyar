import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import { GRADE_OPTIONS } from '@/lib/school'
import { notifySocket } from '@/lib/notify'

/**
 * گروه‌های مدرسه‌ای (غیردرسی) — فقط مدیر مدرسه:
 * - STAFF:   «گروه همکاران» — همه معلمان + معاونان + مدیر مدرسه خودکار عضو می‌شوند
 * - ALL:     «گروه عمومی» — همه کاربران مدرسه با هر نقشی خودکار عضو می‌شوند
 * - GRADE:   «گروه پایه» — همه دانش‌آموزان کلاس‌های آن پایه + معلمان همان پایه + مدیر مدرسه
 * - CUSTOM:  «گروه سفارشی» — هیچ عضو خودکاری ندارد؛ فقط افرادی که مدیر با چک‌باکس انتخاب
 *            می‌کند (دانش‌آموزان و معلمان و معاونان) + مدیر مدرسه به‌عنوان ناظر
 * عضویت گروه‌های خودکار پویاست: هر کاربری که بعداً اضافه شود خودکار عضو می‌ماند.
 */

const SCOPE_BY_TYPE: Record<string, string> = {
  STAFF: 'SCHOOL_STAFF',
  ALL: 'SCHOOL_ALL',
  GRADE: 'GRADE',
  CUSTOM: 'CUSTOM',
}

const DEFAULT_NAMES: Record<string, string> = {
  STAFF: 'گروه همکاران',
  ALL: 'گروه عمومی مدرسه',
}

export async function GET() {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response

  const groups = await db.subjectGroup.findMany({
    where: { schoolId: res.session.schoolId, scope: { not: 'CLASS' } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      scope: true,
      grade: true,
      archivedAt: true,
      lockedForStudents: true,
      messagePolicy: true,
      createdAt: true,
      _count: { select: { messages: true, memberOverrides: true } },
    },
  })

  return NextResponse.json({ groups })
}

export async function POST(req: NextRequest) {
  // معاون: مدیریت گروه‌ها فقط با مجوز مربوطه (سوییچ مدیر مدرسه)
  const res = await requireSchoolManager('groups')
  if ('response' in res) return res.response
  const schoolId = res.session.schoolId

  const body = await req.json().catch(() => null)
  const type = String(body?.type ?? '')
  const scope = SCOPE_BY_TYPE[type]
  if (!scope) return jsonError('نوع گروه معتبر نیست')

  // نام گروه: برای همکاران/عمومی اگر خالی باشد نام پیش‌فرض رسمی استفاده می‌شود
  const rawName = String(body?.name ?? '').trim()
  const name = rawName || DEFAULT_NAMES[type] || ''
  if (name.length < 2) return jsonError('نام گروه باید حداقل ۲ کاراکتر باشد')
  if (name.length > 80) return jsonError('نام گروه حداکثر ۸۰ کاراکتر است')

  const duplicate = await db.subjectGroup.findFirst({
    where: { schoolId, scope: { not: 'CLASS' }, name },
  })
  if (duplicate) {
    return jsonError('گروهی با این نام در مدرسه شما وجود دارد', 409)
  }

  if (type === 'STAFF') {
    const exists = await db.subjectGroup.findFirst({
      where: { schoolId, scope: 'SCHOOL_STAFF' },
      select: { id: true },
    })
    if (exists) return jsonError('گروه همکاران از قبل وجود دارد', 409)
  }

  if (type === 'ALL') {
    const exists = await db.subjectGroup.findFirst({
      where: { schoolId, scope: 'SCHOOL_ALL' },
      select: { id: true },
    })
    if (exists) return jsonError('گروه عمومی از قبل وجود دارد', 409)
  }

  let grade: string | null = null
  if (type === 'GRADE') {
    const gradeVal = typeof body?.grade === 'string' ? body.grade.trim() : ''
    if (!(GRADE_OPTIONS as readonly string[]).includes(gradeVal)) {
      return jsonError('پایه انتخاب‌شده معتبر نیست')
    }
    const exists = await db.subjectGroup.findFirst({
      where: { schoolId, scope: 'GRADE', grade: gradeVal },
      select: { id: true },
    })
    if (exists) return jsonError(`گروه پایه ${gradeVal} از قبل وجود دارد`, 409)
    // گروه پایه بدون کلاس در آن پایه بی‌معنی است
    const classCount = await db.classroom.count({
      where: { schoolId, grade: gradeVal },
    })
    if (classCount === 0) {
      return jsonError(`در پایه ${gradeVal} کلاسی وجود ندارد؛ ابتدا کلاس بسازید`, 400)
    }
    grade = gradeVal
  }

  // گروه سفارشی — انتخاب اعضا با چک‌باکس از فهرست کاربران مدرسه
  let memberIds: string[] = []
  if (type === 'CUSTOM') {
    const rawIds: unknown[] = Array.isArray(body?.memberIds) ? body.memberIds : []
    memberIds = [...new Set(rawIds.map(String).filter(Boolean))]
    if (memberIds.length === 0) {
      return jsonError('برای گروه سفارشی، انتخاب حداقل یک عضو الزامی است')
    }
    const validMembers = await db.user.findMany({
      where: {
        id: { in: memberIds },
        schoolId,
        isActive: true,
        // مدیر مدرسه خودکار/دائمی عضو است و انتخاب نمی‌شود
        role: { in: ['TEACHER', 'SCHOOL_VICE', 'STUDENT'] },
      },
      select: { id: true },
    })
    if (validMembers.length !== memberIds.length) {
      return jsonError('یکی از اعضای انتخابی در این مدرسه یافت نشد یا مجاز نیست', 400)
    }
  }

  const group = await db.subjectGroup.create({
    data: {
      name,
      scope,
      grade,
      schoolId,
      messagePolicy: 'ALL',
      // گروه سفارشی — اعضای انتخابی مدیر به‌صورت استثنای ADD ثبت می‌شوند
      ...(type === 'CUSTOM'
        ? {
            memberOverrides: {
              create: memberIds.map((userId) => ({ userId, action: 'ADD' as const })),
            },
          }
        : {}),
    },
  })

  // اتاق گروه برای همه کاربران آنلاین مدرسه بازسازی شود (عضویت/فهرست به‌روز)
  const schoolUsers = await db.user.findMany({
    where: { schoolId, role: { in: ['SCHOOL_ADMIN', 'SCHOOL_VICE', 'TEACHER', 'STUDENT'] } },
    select: { id: true },
  })
  await notifySocket({ refreshUserIds: schoolUsers.map((u) => u.id) })

  return NextResponse.json(
    { group: { id: group.id, name: group.name, scope: group.scope, grade: group.grade } },
    { status: 201 },
  )
}
