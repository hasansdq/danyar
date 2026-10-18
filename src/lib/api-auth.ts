import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  getSession,
  clearSessionCookie,
  clearImpersonationCookie,
  type Role,
  type SessionPayload,
  APP_ROLES,
} from '@/lib/session'
import {
  viceHasPermission,
  VICE_DENIED_MESSAGE,
  type VicePermissionKey,
} from '@/lib/vice-permissions'

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** نشست معتبر می‌خواهد؛ در غیر این صورت 401 */
export async function requireAuth(): Promise<
  { session: SessionPayload } | { response: NextResponse }
> {
  const session = await getSession()
  if (!session) return { response: jsonError('ابتدا وارد شوید', 401) }

  // کاربر باید فعال باشد (مثلاً در صورت غیرفعال‌سازی، نشست قدیمی بی‌اعتبار شود)
  const user = await db.user.findUnique({
    where: { id: session.uid },
    select: { isActive: true, schoolId: true, role: true },
  })
  if (!user) {
    // نشست زامبی: توکن امضاشده معتبر است اما کاربرش در دیتابیس نیست (مثلاً پس از
    // بازنشانی/بازبذری دیتابیس سندباکس). 403 قبلی کلاینت را در «لودینگ بی‌پایان»
    // گیر می‌انداخت؛ حالا کوکی‌های نشست/جعل هویت پاک و 401 برمی‌گردد تا کلاینت
    // به صفحه ورود هدایت شود و ورود تازه با شناسهٔ کاربر موجود ساخته شود.
    await clearSessionCookie().catch(() => undefined)
    await clearImpersonationCookie().catch(() => undefined)
    return { response: jsonError('نشست شما معتبر نیست؛ دوباره وارد شوید', 401) }
  }
  if (!user.isActive) {
    return { response: jsonError('حساب کاربری غیرفعال است', 403) }
  }
  return { session: { ...session, schoolId: user.schoolId, role: user.role as Role } }
}

/** فقط نقش‌های مشخص‌شده */
export async function requireRoles(
  roles: Role[],
): Promise<{ session: SessionPayload } | { response: NextResponse }> {
  const res = await requireAuth()
  if ('response' in res) return res
  if (!roles.includes(res.session.role)) {
    return { response: jsonError('دسترسی غیرمجاز', 403) }
  }
  return res
}

/** نقش‌های اپ (مدیر مدرسه/معلم/دانش‌آموز) که حتماً به مدرسه‌ای وابسته‌اند */
export async function requireAppRole(): Promise<
  { session: SessionPayload & { schoolId: string } } | { response: NextResponse }
> {
  const res = await requireRoles(APP_ROLES)
  if ('response' in res) return res
  if (!res.session.schoolId) {
    return { response: jsonError('این کاربر به مدرسه‌ای متصل نیست', 403) }
  }
  return { session: res.session as SessionPayload & { schoolId: string } }
}

/** فقط مدیر مدرسه؛ خروجی شامل schoolId معتبر */
export async function requireSchoolAdmin(): Promise<
  { session: SessionPayload & { schoolId: string } } | { response: NextResponse }
> {
  const res = await requireRoles(['SCHOOL_ADMIN'])
  if ('response' in res) return res
  if (!res.session.schoolId) {
    return { response: jsonError('این کاربر به مدرسه‌ای متصل نیست', 403) }
  }
  return { session: res.session as SessionPayload & { schoolId: string } }
}

/**
 * مدیر یا معاون مدرسه — معاون «همهٔ» دسترسی‌های مدیر را دارد
 * مگر آنکه مدیر مدرسه آن مجوز را برای او محدود کرده باشد (سوییچ /modir/deputies).
 * - perm ارسال نشود → فقط نقش بررسی می‌شود (معاون بدون محدودیت اضافه)
 * - perm ارسال شود → برای معاون ردیف VicePermission چک می‌شود (پیش‌فرض روشن)
 */
export async function requireSchoolManager(
  perm?: VicePermissionKey,
): Promise<
  { session: SessionPayload & { schoolId: string } } | { response: NextResponse }
> {
  const res = await requireRoles(['SCHOOL_ADMIN', 'SCHOOL_VICE'])
  if ('response' in res) return res
  if (!res.session.schoolId) {
    return { response: jsonError('این کاربر به مدرسه‌ای متصل نیست', 403) }
  }
  if (perm && res.session.role === 'SCHOOL_VICE') {
    const ok = await viceHasPermission(res.session, perm)
    if (!ok) return { response: jsonError(VICE_DENIED_MESSAGE, 403) }
  }
  return { session: res.session as SessionPayload & { schoolId: string } }
}

/** فقط مدیر کل پلتفرم */
export async function requireSuperAdmin(): Promise<
  { session: SessionPayload } | { response: NextResponse }
> {
  return requireRoles(['SUPER_ADMIN'])
}
