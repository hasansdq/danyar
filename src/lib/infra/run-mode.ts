import { promises as fsp } from 'fs'
import fsSync from 'fs'
import path from 'path'
import os from 'os'
import { RUN_MODE_LABELS, type RunModeInfo } from './types'

/**
 * تشخیص حالت اجرا — فقط برای «نمایش»؛ از پنل قابل تغییر نیست.
 *
 * ترتیب تصمیم (صادقانه و بدون حدس قطعی):
 *  ۱) متغیر صریح INFRA_RUN_MODE (docker-compose/مالک DirectAdmin ست می‌کند)
 *  ۲) نشانگرهای محیط پیش‌نمایش Z.AI (FC_*) → «پیش‌نمایش Z.AI»
 *  ۳) نشانگرهای Docker (/.dockerenv یا cgroup) → Docker
 *     ⚠ در سندباکس Z.AI هم /.dockerenv هست؛ پس نشانگر FC_ مقدم است
 *  ۴) NODE_ENV=development بدون نشانگر بالا → «اجرا مستقیم (توسعه)»
 *  ۵) در غیر این صورت → «نامشخص»
 */

let cached: RunModeInfo | null = null

function detectOnce(): RunModeInfo {
  const explicit = (process.env.INFRA_RUN_MODE ?? '').trim().toLowerCase()
  if (explicit === 'docker') {
    return { mode: 'docker', label: RUN_MODE_LABELS.docker, source: 'متغیر INFRA_RUN_MODE' }
  }
  if (explicit === 'direct') {
    return { mode: 'direct', label: RUN_MODE_LABELS.direct, source: 'متغیر INFRA_RUN_MODE' }
  }
  if (explicit === 'preview') {
    return { mode: 'preview', label: RUN_MODE_LABELS.preview, source: 'متغیر INFRA_RUN_MODE' }
  }

  // نشانگرهای مستقیم سندباکس/پیش‌نمایش Z.AI (Function Compute) — وقتی به
  // پروسهٔ سرور به ارث رسیده باشند منبع قطعی‌اند
  if (process.env.FC_CONTAINER_ID || process.env.FC_FUNCTION_NAME || process.env.FC_INSTANCE_ID) {
    return {
      mode: 'preview',
      label: RUN_MODE_LABELS.preview,
      source: 'نشانگرهای محیط سندباکس (FC_*)',
    }
  }

  // نشانه‌های ساختاری سندباکس Z.AI: cgroup با k8s.io + درگاه پیش‌نمایش :81
  // (در استقرار Docker/DirectAdmin این ترکیب وجود ندارد) — تشخیص خودکار
  if (isZaiSandbox()) {
    return {
      mode: 'preview',
      label: RUN_MODE_LABELS.preview,
      source: 'تشخیص خودکار محیط سندباکس (cgroup/درگاه :۸۱)',
    }
  }

  // نشانگرهای Docker — بعد از رد کردن سندباکس (که خودش /.dockerenv دارد)
  let cgroupDocker = false
  try {
    cgroupDocker = fsSync.readFileSync('/proc/self/cgroup', 'utf8').includes('docker')
  } catch {
    /* cgroup قابل خواندن نیست */
  }
  if (fsSync.existsSync('/.dockerenv') || cgroupDocker) {
    return { mode: 'docker', label: RUN_MODE_LABELS.docker, source: 'نشانگرهای کانتینر Docker' }
  }

  if (process.env.NODE_ENV === 'development') {
    return {
      mode: 'direct',
      label: `${RUN_MODE_LABELS.direct} (توسعه)`,
      source: 'NODE_ENV=development بدون نشانگر کانتینر',
    }
  }

  return {
    mode: 'unknown',
    label: RUN_MODE_LABELS.unknown,
    source: 'هیچ نشانگر معتیری یافت نشد — INFRA_RUN_MODE در .env تنظیم کنید',
  }
}

/** ترکیب نشانه‌های سندباکس Z.AI — cgroup با k8s.io یا درگاه گوش‌دهندهٔ :۸۱ */
function isZaiSandbox(): boolean {
  try {
    const cg = fsSync.readFileSync('/proc/self/cgroup', 'utf8')
    if (cg.includes('k8s.io')) return true
  } catch {
    /* ادامه */
  }
  try {
    // /proc/net/tcp — ستون local_address به شکل IP:PORT هگز؛ 0051 = ۸۱
    // فقط «گوش‌دهنده» (st=0A) حساب می‌شود، نه اتصال موقتی به درگاه
    const tcp = fsSync.readFileSync('/proc/net/tcp', 'utf8')
    for (const line of tcp.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/)
      if (cols.length > 3 && cols[1]?.endsWith(':0051') && cols[3] === '0A') return true
    }
  } catch {
    /* ادامه */
  }
  return false
}

/** حالت اجرا — نتیجه کش می‌شود (محیط در طول عمر پروسه تغییر نمی‌کند) */
export function runModeInfo(): RunModeInfo {
  if (!cached) cached = detectOnce()
  return cached
}

/** برچسب منبع شاخص‌های منابع — بر اساس همان تشخیص صادقانه */
export function resourcesScopeLabel(): string {
  const m = runModeInfo()
  if (m.mode === 'preview') return 'محیط پیش‌نمایش'
  if (m.mode === 'docker') return 'کانتینر / میزبان VPS'
  if (m.mode === 'direct') return 'میزبان VPS'
  return 'نامشخص'
}

/** نسخهٔ برنامه — از package.json؛ در نبود آن «نامشخص» (راستی‌آزمایی صادقانه) */
export async function appVersion(): Promise<string> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
    const v = JSON.parse(raw)?.version
    return typeof v === 'string' && v ? v : 'نامشخص'
  } catch {
    return 'نامشخص'
  }
}

/** شروع پروسهٔ سرور Next — برای نمایش «زمان شروع سرویس» */
export function processStartedAt(): number {
  // میلی‌ثانیه از epoch — بر اساس عمر پروسه (دقیق در هر محیطی)
  return Date.now() - Math.floor(process.uptime() * 1000)
}

export function hostUptimeSeconds(): number | null {
  try {
    const raw = fsSync.readFileSync('/proc/uptime', 'utf8')
    const n = Number(raw.split(' ')[0])
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  } catch {
    return os.uptime() || null
  }
}
