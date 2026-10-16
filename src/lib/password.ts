import * as bcrypt from 'bcryptjs'

/**
 * رمز عبور پیش‌فرض همه کاربران جدید (درخواست کاربر):
 * نام کاربری = کدملی، رمز عبور = 123456
 */
export const DEFAULT_USER_PASSWORD = '123456'

/**
 * اعتبارسنجی رمز عبور — قانون کاربر:
 * حداقل ۶ کاراکتر؛ رمز ضعیف (فقط عدد یا فقط حرف) مجاز است.
 * سقف ۷۲ کاراکتر (محدودیت واقعی bcrypt).
 * خروجی: پیام خطا یا null (یعنی معتبر)
 */
export function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 6) {
    return 'رمز عبور باید حداقل ۶ کاراکتر باشد'
  }
  if (pw.length > 72) {
    return 'رمز عبور حداکثر ۷۲ کاراکتر می‌تواند باشد'
  }
  // رمز ضعیف (فقط عدد / فقط حرف / ترکیب ساده) عمداً پذیرفته می‌شود
  return null
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
