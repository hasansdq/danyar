import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

export type Role = 'SUPER_ADMIN' | 'SCHOOL_ADMIN' | 'SCHOOL_VICE' | 'TEACHER' | 'STUDENT'

export const APP_ROLES: Role[] = ['SCHOOL_ADMIN', 'SCHOOL_VICE', 'TEACHER', 'STUDENT']

/** نقش‌های ستاد مدرسه — معاون مدرسه هم‌تراز ستاد در پیام‌رسان/کلاس آنلاین/گروه‌ها */
export const STAFF_ROLES: Role[] = ['SCHOOL_ADMIN', 'SCHOOL_VICE', 'TEACHER']

/** نقش‌هایی که می‌توانند به‌عنوان معلم گروه انتخاب شوند */
export const TEACHER_ROLES: Role[] = ['TEACHER', 'SCHOOL_VICE']

export interface SessionPayload {
  uid: string
  username: string
  fullName: string
  role: Role
  schoolId: string | null
  /** در حالت جعل هویت: شناسه مدیر کل اصلی */
  impersonatedBy?: string
  /** ورود با رمز پیش‌فرض (123456) — کاربر باید پیش از ادامه رمز خود را تغییر دهد (درخواست کاربر) */
  pwdDefault?: boolean
}

const COOKIE_NAME = 'daniar_session'
const IMPERSONATE_COOKIE_NAME = 'daniar_imp'
const SESSION_DAYS = 7
const IMPERSONATION_HOURS = 2

// SameSite=None + Secure تا نشست داخل iframe پیش‌نمایش زنده (مبدأ پلتفرم) هم کار کند؛
// جبران محافظت Lax: گارد Sec-Fetch-Site در proxy.ts برای متدهای تغییردهنده
// (Chrome/Firefox لوکال‌هاست را trustworthy می‌دانند و کوکی Secure روی http://localhost هم می‌پذیرند)
const COOKIE_SAME_SITE = 'none' as const
const COOKIE_SECURE = true

function getSecret(): Uint8Array {
  // محیط عملیاتی بدون کلید امن یا با کلید نمونه → بلافاصله متوقف می‌شود (هیچ‌گاه با کلید ثابت سرو نمی‌شود)
  if (
    process.env.NODE_ENV === 'production' &&
    (!process.env.SESSION_SECRET ||
      process.env.SESSION_SECRET === 'daniar-dev-secret-change-me-in-production' ||
      process.env.SESSION_SECRET === 'please-change-this-secret-in-production')
  ) {
    throw new Error(
      '[daniar] SESSION_SECRET تنظیم نشده یا هنوز مقدار نمونه است — در .env سرور با openssl rand -base64 32 مقدار امن بسازید',
    )
  }
  const secret =
    process.env.SESSION_SECRET ?? 'daniar-dev-secret-change-me-in-production'
  return new TextEncoder().encode(secret)
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSecret())
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret())
    if (!payload.uid || !payload.role) return null
    return {
      uid: String(payload.uid),
      username: String(payload.username ?? ''),
      fullName: String(payload.fullName ?? ''),
      role: payload.role as Role,
      schoolId: (payload.schoolId as string | null) ?? null,
      ...(payload.impBy ? { impersonatedBy: String(payload.impBy) } : {}),
      ...(payload.pwdDefault ? { pwdDefault: true } : {}),
    }
  } catch {
    return null
  }
}

/** خواندن نشست از کوکی — در صورت جعل هویت، نشست کاربر هدف اولویت دارد */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const imp = await verifySessionToken(store.get(IMPERSONATE_COOKIE_NAME)?.value)
  if (imp) return imp
  return verifySessionToken(store.get(COOKIE_NAME)?.value)
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = await signSession(payload)
  const store = await cookies()
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: '/',
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    maxAge: 0,
    path: '/',
  })
}

// ─── جعل هویت (ورود مدیر کل به‌جای کاربر) ───

export async function setImpersonationCookie(payload: SessionPayload) {
  const token = await new SignJWT({ ...payload, impBy: payload.impersonatedBy ?? '' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${IMPERSONATION_HOURS}h`)
    .sign(getSecret())
  const store = await cookies()
  store.set(IMPERSONATE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    maxAge: IMPERSONATION_HOURS * 60 * 60,
    path: '/',
  })
}

export async function clearImpersonationCookie() {
  const store = await cookies()
  store.set(IMPERSONATE_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: COOKIE_SAME_SITE,
    secure: COOKIE_SECURE,
    maxAge: 0,
    path: '/',
  })
}

export async function getImpersonation(): Promise<SessionPayload | null> {
  const store = await cookies()
  return verifySessionToken(store.get(IMPERSONATE_COOKIE_NAME)?.value)
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const IMPERSONATE_COOKIE = IMPERSONATE_COOKIE_NAME
