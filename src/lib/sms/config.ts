import { db } from '@/lib/db'
import { SMS_PROVIDER_FIELDS } from '@/lib/sms/providers'

/**
 * پیکربندی ورود و پیامک — تک‌ردیفی؛ ایجاد خودکار ردیف پیش‌فرض
 * و ماسک‌کردن فیلدهای محرمانه برای نمایش به مدیر کل.
 */

export async function ensureSmsConfig() {
  const existing = await db.smsConfig.findUnique({ where: { id: 1 } })
  if (existing) return existing
  return db.smsConfig.create({ data: { id: 1 } })
}

export interface PublicSmsConfig {
  passwordLoginEnabled: boolean
  smsLoginEnabled: boolean
  provider: string
  enabled: boolean
  codeTtlSeconds: number
  resendCooldownSeconds: number
  maxAttemptsPerCode: number
  maxRequestsPerHour: number
  /** فیلدهای غیرمحرمانه + ماسک فیلدهای محرمانه (مقدار واقعی هرگز خارج نمی‌شود) */
  credentials: Record<string, string>
}

export function publicSmsConfig(row: {
  passwordLoginEnabled: boolean
  smsLoginEnabled: boolean
  provider: string
  enabled: boolean
  credentials: string
  codeTtlSeconds: number
  resendCooldownSeconds: number
  maxAttemptsPerCode: number
  maxRequestsPerHour: number
}): PublicSmsConfig {
  let creds: Record<string, string> = {}
  try {
    creds = JSON.parse(row.credentials || '{}') as Record<string, string>
  } catch {
    creds = {}
  }
  const fields = SMS_PROVIDER_FIELDS[row.provider] ?? []
  const publicCreds: Record<string, string> = {}
  for (const f of fields) {
    const v = creds[f.key] ?? ''
    publicCreds[f.key] = f.secret ? (v ? '••••' + v.slice(-4) : '') : v
  }
  return {
    passwordLoginEnabled: row.passwordLoginEnabled,
    smsLoginEnabled: row.smsLoginEnabled,
    provider: row.provider,
    enabled: row.enabled,
    codeTtlSeconds: row.codeTtlSeconds,
    resendCooldownSeconds: row.resendCooldownSeconds,
    maxAttemptsPerCode: row.maxAttemptsPerCode,
    maxRequestsPerHour: row.maxRequestsPerHour,
    credentials: publicCreds,
  }
}

/** ادغام اعتبارهای جدید: فیلد محرمانه فقط با مقدار غیرخالی جایگزین می‌شود */
export function mergeCredentials(
  currentJson: string,
  incoming: Record<string, unknown> | null | undefined,
): string {
  let current: Record<string, string> = {}
  try {
    current = JSON.parse(currentJson || '{}') as Record<string, string>
  } catch {
    current = {}
  }
  if (!incoming) return JSON.stringify(current)
  const next = { ...current }
  for (const [k, v] of Object.entries(incoming)) {
    if (typeof v !== 'string') continue
    // ماسک برگشتی یعنی «بدون تغییر»
    if (v.startsWith('••••')) continue
    next[k] = v
  }
  return JSON.stringify(next)
}
