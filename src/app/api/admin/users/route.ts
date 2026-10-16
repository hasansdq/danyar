import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'

/** فهرست سراسری کاربران پلتفرم — فقط مدیر کل؛ با جست‌وجو، فیلتر مدرسه/نقش و صفحه‌بندی */
export async function GET(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const schoolId = sp.get('schoolId') ?? ''
  const role = sp.get('role') ?? ''
  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt(sp.get('pageSize') ?? '20') || 20))

  const where: Record<string, unknown> = {}
  if (q) {
    where.OR = [
      { fullName: { contains: q } },
      { username: { contains: q } },
    ]
  }
  if (schoolId) where.schoolId = schoolId
  if (['SUPER_ADMIN', 'SCHOOL_ADMIN', 'SCHOOL_VICE', 'TEACHER', 'STUDENT'].includes(role)) where.role = role

  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
        school: { select: { id: true, name: true, isActive: true } },
        _count: { select: { enrollments: true, teachingAssignments: true } },
      },
    }),
  ])

  return NextResponse.json({ users, total, page, pageSize })
}

/** فعال/غیرفعال‌سازی هر کاربر توسط مدیر کل (به‌جز خودش) */
export async function PATCH(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const userId = String(body?.userId ?? '')
  if (!userId) return jsonError('شناسه کاربر الزامی است')
  if (userId === res.session.uid) return jsonError('نمی‌توانید حساب خودتان را تغییر دهید')
  if (typeof body?.isActive !== 'boolean') return jsonError('وضعیت ارسال نشده است')

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) return jsonError('کاربر یافت نشد', 404)

  const updated = await db.user.update({
    where: { id: userId },
    data: { isActive: body.isActive },
    select: { id: true, isActive: true },
  })
  return NextResponse.json({ user: updated })
}

/** بررسی اعتبار نام کاربری و شماره‌های سراسری برای فیلترها */
export async function POST() {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const [schools, roleCounts] = await Promise.all([
    db.school.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.groupBy({ by: ['role'], _count: { _all: true } }),
  ])

  return NextResponse.json({
    schools,
    roleCounts: Object.fromEntries(roleCounts.map((r) => [r.role, r._count._all])),
  })
}
