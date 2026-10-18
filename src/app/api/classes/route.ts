import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSchoolManager, jsonError } from '@/lib/api-auth'
import { BRANCH_MAX, GRADE_OPTIONS, composeClassName } from '@/lib/school'

export async function GET() {
  const res = await requireSchoolManager()
  if ('response' in res) return res.response

  const classrooms = await db.classroom.findMany({
    where: { schoolId: res.session.schoolId },
    orderBy: { createdAt: 'asc' },
    include: {
      _count: { select: { subjectGroups: true, enrollments: true } },
    },
  })
  return NextResponse.json({ classrooms })
}

export async function POST(req: NextRequest) {
  // معاون: مدیریت کلاس‌ها فقط با مجوز مربوطه (سوییچ مدیر مدرسه)
  const res = await requireSchoolManager('classes')
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)

  // الگوی جدید: {grade, branch} → نام کلاس «پایه + شعبه» سمت سرور ساخته می‌شود (مثلاً «هفتم ۷۰۳»)
  const grade = typeof body?.grade === 'string' ? body.grade.trim() : ''
  const branch = typeof body?.branch === 'string' ? String(body.branch).trim() : ''
  let name = typeof body?.name === 'string' ? body.name.trim() : ''

  if (grade || branch) {
    if (!(GRADE_OPTIONS as readonly string[]).includes(grade)) {
      return jsonError('پایه انتخاب‌شده معتبر نیست')
    }
    if (!branch || branch.length > BRANCH_MAX) {
      return jsonError(`نام شعبه را وارد کنید (حداکثر ${BRANCH_MAX} کاراکتر)`)
    }
    name = composeClassName(grade, branch)
  }

  if (name.length < 2) return jsonError('نام کلاس باید حداقل ۲ کاراکتر باشد')

  const duplicate = await db.classroom.findFirst({
    where: { schoolId: res.session.schoolId, name },
  })
  if (duplicate) return jsonError('کلاسی با این نام در مدرسه شما وجود دارد', 409)

  const classroom = await db.classroom.create({
    data: {
      name,
      schoolId: res.session.schoolId,
      // پایه همیشه از الگوی پایه+شعبه ذخیره می‌شود — مبنای گروه‌های پایه‌ای
      grade: grade || null,
    },
  })
  return NextResponse.json({ classroom }, { status: 201 })
}

/**
 * ویرایش گروهی کلاس‌های مدرسه (بخش «محدودیت گروه‌ها» پنل مدیر):
 * { allowStudentDm: boolean } → فعال/غیرفعال‌شدن گفتگوی خصوصی بین دانش‌آموزان
 * همه کلاس‌های مدرسه به‌یک‌بار.
 */
export async function PATCH(req: NextRequest) {
  // معاون: مدیریت کلاس‌ها فقط با مجوز مربوطه (سوییچ مدیر مدرسه)
  const res = await requireSchoolManager('classes')
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  if (typeof body?.allowStudentDm !== 'boolean') {
    return jsonError('مقدار allowStudentDm باید true یا false باشد')
  }

  const result = await db.classroom.updateMany({
    where: { schoolId: res.session.schoolId },
    data: { allowStudentDm: body.allowStudentDm },
  })

  return NextResponse.json({ updated: result.count })
}
