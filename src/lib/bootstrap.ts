/**
 * Bootstrap خودترمیم دانیار
 * ──────────────────────────
 * مشکل: سندباکس گاهی بین‌جلسه‌ای کل ردیف‌های دیتابیس را پاک می‌کند؛
 * نتیجه: حساب superadmin و کاربران دمو «ناپدید» می‌شوند و رمزهای اعلامی با 401 رد می‌شوند
 * (رمز عوض نشده — حساب کلاً حذف شده است).
 *
 * راه‌حل: پیش از هر ورود، اگر حساب‌ها غایب باشند همین‌جا بازسازی می‌شوند:
 * - حساب superadmin فقط در توسعه؛ در production ساخت حساب با سرویس migrate است
 * - دادهٔ دمو فقط در محیط پیش‌نمایش/توسعه و فقط وقتی هیچ مدرسه‌ای در دیتابیس نیست
 * - ترمیم schema فقط در توسعه و با اجازه صریح؛ production فقط از migration استفاده می‌کند
 *
 * هزینهٔ مسیر سریع: حداکثر یک count در هر ۳۰ ثانیه؛ مسیر ورود شکست‌خورده همیشه
 * یک بازرسی اجباری + تلاش مجدد می‌گیرد تا ترمیم همین‌جا و لحظه‌ای اتفاق بیفتد.
 */
import { execSync } from 'node:child_process'
import { db } from './db'
import { ensureSuperadmin, ensureViolationTypes, seedDemoData } from './seed-data'

const RECHECK_INTERVAL_MS = 30_000
const SCHEMA_REPAIR_TIMEOUT_MS = 120_000

export interface BootstrapResult {
  ok: boolean
  healed: boolean
  reason?: string
}

let healthyUntil = 0
let inflight: Promise<BootstrapResult> | null = null

/** دادهٔ دمو فقط در محیط سندباکس/توسعه بازسازی می‌شود — هرگز در استقرار واقعی */
const isPreviewSandbox = () =>
  process.env.NODE_ENV !== 'production' &&
  (process.env.INFRA_RUN_MODE === 'preview' || process.env.NODE_ENV === 'development')

function repairSchema(): boolean {
  if (!isPreviewSandbox() || process.env.DANIAR_ALLOW_DEV_SCHEMA_REPAIR !== '1') return false
  try {
    execSync('bunx prisma db push --skip-generate', {
      cwd: process.cwd(),
      timeout: SCHEMA_REPAIR_TIMEOUT_MS,
      stdio: 'pipe',
    })
    return true
  } catch (err) {
    console.error(
      '[bootstrap] بازسازی شِمای دیتابیس ناموفق:',
      (err as Error | undefined)?.message?.slice(0, 400),
    )
    return false
  }
}

async function runBootstrap(): Promise<BootstrapResult> {
  try {
    let userCount: number
    try {
      userCount = await db.user.count()
    } catch (countErr) {
      // Never repair a production database from a login request.
      if (!isPreviewSandbox() || process.env.DANIAR_ALLOW_DEV_SCHEMA_REPAIR !== '1') {
        console.error('[bootstrap] دیتابیس در دسترس نیست؛ schema خودکار تغییر نمی‌کند. وضعیت سرویس migrate را بررسی کنید.')
        return { ok: false, healed: false, reason: 'db-unreachable' }
      }
      console.warn(
        '[bootstrap] دیتابیس پاسخگو نیست — تلاش برای بازسازی شِما…',
        (countErr as Error | undefined)?.message?.slice(0, 200),
      )
      if (!repairSchema()) {
        return { ok: false, healed: false, reason: 'schema-repair-failed' }
      }
      try {
        userCount = await db.user.count()
      } catch {
        return { ok: false, healed: false, reason: 'db-unreachable' }
      }
    }

    let healed = false

    // Production accounts are created only by the migration/seed service.
    if (isPreviewSandbox() && await ensureSuperadmin(db)) {
      healed = true
      console.log('[bootstrap] حساب مدیر کل بازسازی شد (superadmin — رمز اولیه از SUPERADMIN_INITIAL_PASSWORD)')
    }

    // انواع تخلف (پیکربندی سراسری مثل SmsConfig) — فهرست پیش‌فرض در نبود هر گزینه
    if (await ensureViolationTypes(db)) {
      healed = true
      console.log('[bootstrap] فهرست انواع تخلف پیش‌فرض ساخته شد')
    }

    // دادهٔ دمو — فقط سندباکس و فقط وقتی هیچ مدرسه‌ای نیست (یعنی دادهٔ واقعی‌ای وجود ندارد)
    if (isPreviewSandbox() && userCount <= 1) {
      const schoolCount = await db.school.count()
      if (schoolCount === 0) {
        const summary = await seedDemoData(db, { clean: true })
        healed = true
        console.log('[bootstrap] دادهٔ دمو بازسازی شد:', summary)
      }
    }

    healthyUntil = Date.now() + RECHECK_INTERVAL_MS
    return { ok: true, healed }
  } catch (err) {
    console.error('[bootstrap] خودترمیم ناموفق:', err)
    return { ok: false, healed: false, reason: 'heal-error' }
  }
}

/**
 * تضمین سلامت دادهٔ پایه. force=true بازرسی فوری (مسیر ورود شکست‌خورده).
 * هم‌زمانی: تلاش‌های موازی به همان promise در جریان تبدیل می‌شوند (قفل حافظه‌ای).
 */
export function ensureSeeded(force = false): Promise<BootstrapResult> {
  // next build has no database; rendering login pages must not provision one.
  if (!process.env.DATABASE_URL || process.env.NEXT_PHASE === 'phase-production-build') {
    return Promise.resolve({ ok: false, healed: false, reason: 'db-not-configured' })
  }
  if (!force && Date.now() < healthyUntil) {
    return Promise.resolve({ ok: true, healed: false })
  }
  if (inflight) return inflight
  inflight = runBootstrap().finally(() => {
    inflight = null
  })
  return inflight
}
