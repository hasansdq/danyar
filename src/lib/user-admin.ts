import { db } from '@/lib/db'
import { hashPassword, DEFAULT_USER_PASSWORD, validatePassword } from '@/lib/password'
import { normalizePhone, normalizeDigits } from '@/lib/phone'

/**
 * ابزار مشترک افزودن کاربر (درخواست کاربر):
 * - فیلدهای افزودن: نام، نام خانوادگی، نقش، کدملی، شماره تماس، کلاس (+ مدرسه برای مدیر کل)
 * - نام کاربری همه کاربران = کدملی
 * - رمز عبور همه کاربران جدید = 123456 (رمز پیش‌فرض)
 * این lib توسط همه مسیرهای ایجاد کاربر (تکی/گروهی/اکسل، مدیر مدرسه/مدیر کل) استفاده می‌شود.
 */

/** نقش‌های مجاز برای افزودن کاربر — مدیر مدرسه معلم/معاون/دانش‌آموز می‌سازد؛ مدیر کل هر سه + مدیر مدرسه */
export const CREATABE_ROLES = ['STUDENT', 'TEACHER', 'SCHOOL_VICE', 'SCHOOL_ADMIN'] as const
export type CreatableRole = (typeof CREATABE_ROLES)[number]

/**
 * نرمال‌سازی کدملی: ارقام فارسی/عربی به انگلیسی، حذف فاصله و خط تیره.
 * کدملی باید فقط عدد باشد (۴ تا ۲۰ رقم — کدملی استاندارد ایران ۱۰ رقم).
 * خروجی همان نام کاربری کاربر خواهد بود؛ null = نامعتبر
 */
export function normalizeNationalId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = normalizeDigits(String(raw)).replace(/[\s\-_.]/g, '')
  if (!/^\d{4,20}$/.test(s)) return null
  return s
}

/**
 * تبدیل ستون نقش اکسل/فرم به نقش دیتابیس.
 * فارسی و انگلیسی و جاهای خالی (پیش‌فرض دانش‌آموز) پذیرفته می‌شود.
 */
export function parseRoleToken(raw: unknown): CreatableRole | null {
  if (raw === null || raw === undefined) return null
  // هم نقش ثابت دیتابیس (SCHOOL_VICE) و هم معادل فارسی/انگلیسی پذیرفته می‌شود
  const v = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[\u200c_]+/g, ' ')
    .replace(/\s+/g, ' ')
  if (!v) return null
  if (['دانش آموز', 'دانشاموز', 'student', 'pupil', 'شاگرد'].includes(v)) return 'STUDENT'
  if (['معلم', 'استاد', 'teacher', 'teatcher', 'tacher'].includes(v)) return 'TEACHER'
  if (['مدیر مدرسه', 'مدیر', 'school admin', 'admin', 'principal'].includes(v)) return 'SCHOOL_ADMIN'
  if (['معاون مدرسه', 'معاون', 'vice principal', 'deputy', 'school vice', 'schoolvice'].includes(v))
    return 'SCHOOL_VICE'
  return null
}

export function roleFa(role: string): string {
  if (role === 'TEACHER') return 'معلم'
  if (role === 'STUDENT') return 'دانش‌آموز'
  if (role === 'SCHOOL_ADMIN') return 'مدیر مدرسه'
  if (role === 'SCHOOL_VICE') return 'معاون مدرسه'
  if (role === 'SUPER_ADMIN') return 'مدیر کل'
  return role
}

/** ترکیب نام کامل از نام و نام خانوادگی */
export function composeFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}

/** اعتبارسنجی نام: هر یک حداقل ۲ کاراکتر */
export function validateNamePart(v: string, label: string): string | null {
  if (v.length < 2) return `${label} باید حداقل ۲ کاراکتر باشد`
  if (v.length > 60) return `${label} حداکثر ۶۰ کاراکتر می‌تواند باشد`
  return null
}

/** خطای یکتایی Prisma برای username/phone به پیام فارسی */
function uniqueError(e: unknown, field: 'username' | 'phone'): string | null {
  const err = e as { code?: string; message?: string }
  if (err?.code === 'P2002') {
    if (field === 'username' && String(err.message ?? '').includes('username')) {
      return 'این کدملی قبلاً در پلتفرم ثبت شده است'
    }
    if (field === 'phone' && String(err.message ?? '').includes('phone')) {
      return 'این شماره قبلاً برای کاربر دیگری ثبت شده است'
    }
  }
  return null
}

export interface CreateUserAccountInput {
  schoolId: string
  role: CreatableRole
  firstName: string
  lastName: string
  /** کدملی نرمال‌شده — همان نام کاربری خواهد بود */
  nationalId: string
  /** شماره اختیاری — نرمال‌نشده؛ درون تابع نرمال می‌شود */
  phone?: string | null
  /** فقط برای دانش‌آموز — کلاس مدرسه‌ی همان schoolId */
  classroomId?: string | null
  /** فقط برای معلم/معاون — گروه‌های درسی مدرسه‌ی همان schoolId (برای معلم الزامی، برای معاون اختیاری) */
  subjectGroupIds?: string[]
}

export type CreateUserAccountResult =
  | { ok: true; user: { id: string; username: string; fullName: string; role: string } }
  | { ok: false; error: string }

/**
 * ایجاد حساب کاربر با نام کاربری = کدملی و رمز پیش‌فرض 123456.
 * - کلاس فقط برای دانش‌آموز اعمال می‌شود و باید متعلق به همان مدرسه باشد
 * - شماره یکتا در کل پلتفرم است
 * - همه اعتبارسنجی‌ها دوباره اینجا انجام می‌شود (نگهبان سراسری)
 */
export async function createUserAccount(
  input: CreateUserAccountInput,
): Promise<CreateUserAccountResult> {
  const { schoolId, role, nationalId } = input

  const firstName = String(input.firstName ?? '').trim()
  const lastName = String(input.lastName ?? '').trim()
  const nameErr = validateNamePart(firstName, 'نام') ?? validateNamePart(lastName, 'نام خانوادگی')
  if (nameErr) return { ok: false, error: nameErr }

  if (!CREATABE_ROLES.includes(role)) return { ok: false, error: 'نقش نامعتبر است' }
  if (!schoolId) return { ok: false, error: 'مدرسه الزامی است' }

  if (!/^\d{4,20}$/.test(nationalId)) {
    return { ok: false, error: 'کدملی باید فقط عدد باشد (کدملی استاندارد ۱۰ رقم است)' }
  }

  // رمز پیش‌فرض 123456 — همیشه (درخواست کاربر)
  const pwError = validatePassword(DEFAULT_USER_PASSWORD)
  if (pwError) return { ok: false, error: pwError }

  // شماره اختیاری — یکتا در کل پلتفرم
  let phone: string | null = null
  const rawPhone = input.phone
  if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() !== '') {
    phone = normalizePhone(rawPhone)
    if (!phone) return { ok: false, error: 'شماره تلفن معتبر نیست؛ قالب درست: ۰۹xxxxxxxxx' }
    const phoneOwner = await db.user.findUnique({ where: { phone }, select: { id: true } })
    if (phoneOwner) return { ok: false, error: 'این شماره قبلاً برای کاربر دیگری ثبت شده است' }
  }

  // کدملی = نام کاربری — یکتا در کل پلتفرم
  const usernameOwner = await db.user.findUnique({ where: { username: nationalId }, select: { id: true } })
  if (usernameOwner) {
    return { ok: false, error: 'این کدملی قبلاً در پلتفرم ثبت شده است (نام کاربری تکراری)' }
  }

  // کلاس فقط برای دانش‌آموز
  let classroomId: string | null = null
  if (role === 'STUDENT' && input.classroomId) {
    const classroom = await db.classroom.findFirst({
      where: { id: String(input.classroomId), schoolId },
      select: { id: true },
    })
    if (!classroom) return { ok: false, error: 'کلاس انتخابی در این مدرسه یافت نشد' }
    classroomId = classroom.id
  }

  // گروه‌های درسی فقط برای معلم/معاون — همه باید متعلق به همان مدرسه باشند
  let subjectGroupIds: string[] = []
  if (
    (role === 'TEACHER' || role === 'SCHOOL_VICE') &&
    Array.isArray(input.subjectGroupIds) &&
    input.subjectGroupIds.length > 0
  ) {
    const requested = [...new Set(input.subjectGroupIds.map(String))]
    const validGroups = await db.subjectGroup.findMany({
      where: { id: { in: requested }, classroom: { schoolId } },
      select: { id: true },
    })
    if (validGroups.length !== requested.length) {
      return { ok: false, error: 'یکی از گروه‌های درسی انتخابی در این مدرسه یافت نشد' }
    }
    subjectGroupIds = validGroups.map((g) => g.id)
  }

  const passwordHash = await hashPassword(DEFAULT_USER_PASSWORD)

  try {
    const user = await db.user.create({
      data: {
        username: nationalId,
        passwordHash,
        fullName: composeFullName(firstName, lastName),
        firstName,
        lastName,
        role,
        schoolId,
        phone,
        // ثبت‌نام کلاسی دانش‌آموز
        ...(classroomId ? { enrollments: { create: { classroomId } } } : {}),
        // انتساب گروه‌های درسی معلم
        ...(subjectGroupIds.length > 0
          ? { teachingAssignments: { create: subjectGroupIds.map((subjectGroupId) => ({ subjectGroupId })) } }
          : {}),
      },
    })
    return {
      ok: true,
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    }
  } catch (e) {
    return { ok: false, error: uniqueError(e, 'username') ?? uniqueError(e, 'phone') ?? 'خطا در ثبت کاربر' }
  }
}

/** یک ردیف ورودی گروهی/اکسل — پیش از اعتبارسنجی */
export interface RawUserRow {
  firstName?: unknown
  lastName?: unknown
  role?: unknown
  nationalId?: unknown
  phone?: unknown
}

export interface RowResult {
  row: number
  fullName: string
  nationalId: string
  role: string
  status: 'ok' | 'error'
  error?: string
}

export interface ValidatedRow {
  index: number
  role: CreatableRole
  firstName: string
  lastName: string
  nationalId: string
  phone: string | null
}

/**
 * اعتبارسنجی دسته‌ای ردیف‌ها (مشترک بین افزودن گروهی و ایمپورت اکسل).
 * - تکراری‌های درون خود لیست و موجود در پلتفرم را می‌گیرد
 * - شماره‌های تکراری را هم بررسی می‌کند
 * خروجی: نتایج per-row + ردیف‌های سالم برای ثبت
 */
export async function validateUserRows(
  rows: RawUserRow[],
  opts: {
    /** اگر ثابت باشد همه ردیف‌ها این نقش را می‌گیرند (افزودن گروهی دانش‌آموز) */
    fixedRole?: CreatableRole
    /** نقش‌های مجاز — مثلاً مدیر مدرسه نمی‌تواند مدیر بسازد */
    allowedRoles?: CreatableRole[]
    /** مدرسه‌ی جاری برای پیام «در همین مدرسه موجود است» */
    schoolIdForMessage?: string
  } = {},
): Promise<{ results: RowResult[]; valid: ValidatedRow[] }> {
  // نرمال و پیش‌خوانی
  const parsed = rows.map((r) => {
    const firstName = String(r?.firstName ?? '').trim()
    const lastName = String(r?.lastName ?? '').trim()
    const role = opts.fixedRole ?? parseRoleToken(r?.role)
    const nationalId = normalizeNationalId(r?.nationalId)
    const phoneRaw = String(r?.phone ?? '').trim()
    return { firstName, lastName, role, nationalId, phoneRaw }
  })

  // تکراری‌های درون خود لیست (کدملی)
  const seenId = new Map<string, number>()
  parsed.forEach((p, idx) => {
    if (p.nationalId && !seenId.has(p.nationalId)) seenId.set(p.nationalId, idx)
  })
  // تکراری‌های درون خود لیست (شماره)
  const normalizedPhones = parsed.map((p) => (p.phoneRaw ? normalizePhone(p.phoneRaw) : null))
  const seenPhone = new Map<string, number>()
  normalizedPhones.forEach((p, idx) => {
    if (p && !seenPhone.has(p)) seenPhone.set(p, idx)
  })

  // موجود در پلتفرم
  const ids = [...new Set(parsed.map((p) => p.nationalId).filter((v): v is string => !!v))]
  const phones = [...new Set(normalizedPhones.filter((v): v is string => !!v))]
  const [existingUsers, existingPhones] = await Promise.all([
    ids.length
      ? db.user.findMany({
          where: { username: { in: ids } },
          select: { username: true, schoolId: true, school: { select: { name: true } } },
        })
      : Promise.resolve([] as { username: string; schoolId: string | null; school: { name: string } | null }[]),
    phones.length
      ? db.user.findMany({
          where: { phone: { in: phones } },
          select: { phone: true, schoolId: true, school: { select: { name: true } } },
        })
      : Promise.resolve([] as { phone: string | null; schoolId: string | null; school: { name: string } | null }[]),
  ])
  const existingIdMap = new Map(existingUsers.map((u) => [u.username, u]))
  const existingPhoneMap = new Map(existingPhones.map((u) => [u.phone as string, u]))

  const results: RowResult[] = []
  const valid: ValidatedRow[] = []

  parsed.forEach((p, idx) => {
    const fullName = composeFullName(p.firstName, p.lastName)
    const base = { row: idx + 1, fullName, nationalId: p.nationalId ?? '', role: p.role ?? '' }

    let error: string | null = null
    if (!p.firstName || !p.lastName) error = 'نام و نام خانوادگی الزامی است'
    else if (validateNamePart(p.firstName, 'نام') || validateNamePart(p.lastName, 'نام خانوادگی'))
      error = validateNamePart(p.firstName, 'نام') ?? validateNamePart(p.lastName, 'نام خانوادگی')
    else if (!p.role) error = 'نقش معتبر نیست (دانش‌آموز / معلم)'
    else if (opts.allowedRoles && !opts.allowedRoles.includes(p.role))
      error = 'این نقش از این بخش قابل ایجاد نیست'
    else if (!p.nationalId) error = 'کدملی باید فقط عدد باشد'
    else if (seenId.get(p.nationalId) !== idx) error = 'کدملی تکراری در خود لیست'
    else if (existingIdMap.has(p.nationalId)) {
      const ex = existingIdMap.get(p.nationalId)!
      error =
        ex.schoolId === opts.schoolIdForMessage
          ? 'این کدملی در همین مدرسه موجود است'
          : `این کدملی قبلاً در پلتفرم ثبت شده است${ex.school?.name ? ` (مدرسه ${ex.school.name})` : ''}`
    }
    else if (p.phoneRaw && !normalizedPhones[idx]) error = 'شماره تلفن معتبر نیست (۰۹xxxxxxxxx)'
    else if (normalizedPhones[idx] && seenPhone.get(normalizedPhones[idx]!) !== idx)
      error = 'شماره تلفن تکراری در خود لیست'
    else if (normalizedPhones[idx] && existingPhoneMap.has(normalizedPhones[idx]!)) {
      const ex = existingPhoneMap.get(normalizedPhones[idx]!)!
      error = `این شماره قبلاً ثبت شده است${ex.school?.name ? ` (مدرسه ${ex.school.name})` : ''}`
    }

    if (error) {
      results.push({ ...base, status: 'error', error })
    } else {
      valid.push({
        index: idx,
        role: p.role as CreatableRole,
        firstName: p.firstName,
        lastName: p.lastName,
        nationalId: p.nationalId as string,
        phone: normalizedPhones[idx] ?? null,
      })
      results.push({ ...base, role: p.role as string, status: 'ok' })
    }
  })

  return { results, valid }
}

/**
 * ثبت ردیف‌های سالم — خروجی per-row؛ خطای هر ردیف بقیه را متوقف نمی‌کند
 */
export async function commitValidRows(
  valid: ValidatedRow[],
  opts: { schoolId: string; classroomId?: string | null },
): Promise<Record<string, { ok: boolean; error?: string }>> {
  const outcome: Record<string, { ok: boolean; error?: string }> = {}
  for (const v of valid) {
    const res = await createUserAccount({
      schoolId: opts.schoolId,
      role: v.role,
      firstName: v.firstName,
      lastName: v.lastName,
      nationalId: v.nationalId,
      phone: v.phone,
      // کلاس فقط برای دانش‌آموز اعمال می‌شود (درون createUserAccount کنترل می‌شود)
      classroomId: opts.classroomId ?? null,
    })
    outcome[String(v.index)] = res.ok ? { ok: true } : { ok: false, error: res.error }
  }
  return outcome
}
