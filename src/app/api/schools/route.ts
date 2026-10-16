import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'

/** فهرست مدارس با جست‌وجو و صفحه‌بندی */
export async function GET(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const pageSize = Math.min(50, Math.max(5, parseInt(sp.get('pageSize') ?? '20') || 20))

  const where = q ? { name: { contains: q } } : {}

  const [total, schools] = await Promise.all([
    db.school.count({ where }),
    db.school.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { classrooms: true, users: true } },
      },
    }),
  ])

  return NextResponse.json({ schools, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  if (name.length < 2) return jsonError('نام مدرسه باید حداقل ۲ کاراکتر باشد')

  const duplicate = await db.school.findFirst({ where: { name } })
  if (duplicate) return jsonError('مدرسه‌ای با این نام قبلاً ثبت شده است', 409)

  // مدیر مدرسه باید از بین کاربران موجود انتخاب شود
  const adminUserId = String(body?.adminUserId ?? '').trim()
  if (!adminUserId) return jsonError('مدیر مدرسه را از بین کاربران انتخاب کنید')

  const admin = await db.user.findUnique({
    where: { id: adminUserId },
    select: { id: true, fullName: true, role: true, isActive: true },
  })
  if (!admin) return jsonError('کاربر انتخابی برای مدیریت مدرسه یافت نشد', 404)
  if (!admin.isActive) return jsonError('کاربر انتخابی غیرفعال است', 400)
  if (admin.role === 'SUPER_ADMIN') return jsonError('مدیر کل پلتفرم نمی‌تواند مدیر مدرسه شود', 400)

  // ساخت مدرسه + انتصاب کاربر انتخابی به‌عنوان مدیر همان مدرسه — اتمیک
  const school = await db.$transaction(async (tx) => {
    const created = await tx.school.create({ data: { name } })
    await tx.user.update({
      where: { id: adminUserId },
      data: { role: 'SCHOOL_ADMIN', schoolId: created.id },
    })
    return created
  })

  return NextResponse.json(
    { school, admin: { id: admin.id, fullName: admin.fullName } },
    { status: 201 },
  )
}
