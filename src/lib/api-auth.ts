import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  getSession,
  type Role,
  type SessionPayload,
  APP_ROLES,
} from '@/lib/session'

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
  if (!user || !user.isActive) {
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

/** فقط مدیر کل پلتفرم */
export async function requireSuperAdmin(): Promise<
  { session: SessionPayload } | { response: NextResponse }
> {
  return requireRoles(['SUPER_ADMIN'])
}
