/**
 * خودترمیمی زیرساخت رسانه (LiveKit) — سمت سرور
 *
 * مشکل تکرارشوندهٔ سندباکس: بین جلسات، .env بازنشانی می‌شود (فقط DATABASE_URL
 * می‌ماند) و پروسهٔ LiveKit (:7880) از کار می‌افتد. نتیجه: توکن اتاق کلاس ۵۰۳
 * «سرویس رسانه (LiveKit) پیکربندی نشده است» می‌دهد و چون اتصال SFU برقرار
 * نمی‌شود، میکروفون/دوربین/اشتراک صفحه هم همه «سرور رسانه در دسترس نیست»
 * می‌شوند (roomRef نال است). dev-up.sh این‌ها را ترمیم می‌کند ولی باید دستی
 * اجرا شود — این ماژول همان ترمیم را «از داخل خود اپلیکیشن» انجام می‌دهد:
 *
 *   ۱) hydrateEnvFromDisk — کلیدهای غایب process.env از فایل .env و اگر نبود
 *      از نسخهٔ tracking‌شدهٔ گیت (git show HEAD:.env) پر می‌شود. هیچ کلیدی
 *      ساخته/حدس زده نمی‌شود و مقدارهای موجود هرگز بازنویسی نمی‌شوند؛
 *      اصل امنیتی «بدون کلید پیش‌فرض» حفظ می‌شود.
 *   ۲) ensureLivekitProcess — اگر :7880 سالم نیست، باینری بومی
 *      .tools/livekit-server با همان .tools/livekit-dev.yaml و کلیدهای
 *      .env به‌صورت detached بالا آورده می‌شود (الگوی دو‌مرحله‌ای setsid معادل).
 *   ۳) bootSelfHeal — قلاب بوت (instrumentation.register): hydrate + تضمین
 *      LiveKit + بالا‌آوردن نگهبان scripts/dev-watchdog.sh اگر اجرا نیست.
 *
 * همهٔ توابع idempotent هستند؛ فراخوانی هم‌زمان چند درخواست هم فقط یک
 * عملیات ایجاد می‌کند (قفل in-flight در سطح ماژول).
 */

import { execFile } from 'child_process'
import { existsSync, openSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import { livekitServerConfig, type LivekitServerConfig } from '@/lib/livekit'

const execFileP = promisify(execFile)

/** کلیدهایی که بدون آن‌ها رسانه کلاس قطعاً کار نمی‌کند (برای گزارش نتیجه) */
const MEDIA_ENV_KEYS = ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const

/** تجزیهٔ متن .env — KEY=VALUE، نقل‌قول، export، کامنت؛ فقط خطوط ساده */
function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const noExport = line.replace(/^export\s+/, '')
    const eq = noExport.indexOf('=')
    if (eq <= 0) continue
    const key = noExport.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let val = noExport.slice(eq + 1).trim()
    // مقدار inline-comment بدون نقل‌قول را هم مثل dotenv برش می‌زنیم
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1)
    } else {
      const hash = val.indexOf(' #')
      if (hash >= 0) val = val.slice(0, hash).trim()
    }
    out[key] = val
  }
  return out
}

/** کلید غایب/خالی در process.env؟ (کلیدی که اصلاً موجود نیست هم «غایب» است) */
function isAbsent(k: string): boolean {
  const v = process.env[k]
  return v === undefined || v === ''
}

let hydrationMemo: Promise<boolean> | null = null

/**
 * پرکردن کلیدهای غایب process.env از فایل .env و در صورت نبود از گیت.
 * true یعنی حداقل یکی از کلیدهای رسانه بعد از فراخوانی موجود است.
 */
export function hydrateEnvFromDisk(): Promise<boolean> {
  if (!hydrationMemo) {
    hydrationMemo = (async () => {
      const cwd = process.cwd()
      const before = MEDIA_ENV_KEYS.some((k) => (process.env[k] ?? '').trim() !== '')
      if (before) return true

      // منبع ۱ — فایل .env روی دیسک (شاید بعد از بوتِ پروسه درست شده باشد)
      const candidates: Record<string, string>[] = []
      try {
        const { readFile } = await import('fs/promises')
        candidates.push(parseEnvText(await readFile(join(cwd, '.env'), 'utf8')))
      } catch {
        /* فایل نیست یا خوانده نشد — منبع بعدی */
      }
      // منبع ۲ — نسخهٔ tracking‌شدهٔ گیت (الگوی ترمیم dev-up.sh)
      if (!MEDIA_ENV_KEYS.some((k) => (process.env[k] ?? '').trim() !== '')) {
        try {
          const { stdout } = await execFileP('git', ['-C', cwd, 'show', 'HEAD:.env'], {
            timeout: 5000,
          })
          candidates.push(parseEnvText(stdout))
        } catch {
          /* .env در گیت نیست — چیزی برای بازگردانی نیست */
        }
      }

      // فقط کلیدهای «غایب/خالی» پر می‌شوند؛ مقدارهای موجود هرگز بازنویسی نمی‌شوند
      let filled = 0
      for (const src of candidates) {
        for (const [k, v] of Object.entries(src)) {
          if (!isAbsent(k) || v === '') continue
          process.env[k] = v
          filled++
        }
      }
      const ok = MEDIA_ENV_KEYS.every((k) => (process.env[k] ?? '').trim() !== '')
      console.log(
        `[media-selfheal] hydrate: ${filled} کلید پر شد؛ پیکربندی رسانه: ${ok ? 'کامل' : 'ناقص'}`,
      )
      // تلاش ناموفق حافظه نمی‌شود — بعداً (مثلاً بعد از ترمیم .env توسط نگهبان) دوباره امتحان می‌شود
      if (!ok) hydrationMemo = null
      return ok
    })().catch((e) => {
      console.error('[media-selfheal] hydrate error:', e)
      hydrationMemo = null
      return false
    })
  }
  return hydrationMemo
}

/** سلامت HTTP سرور LiveKit روی :7880 */
export async function livekitHealthy(timeoutMs = 900): Promise<boolean> {
  try {
    const r = await fetch('http://127.0.0.1:7880/', {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    return r.status === 200
  } catch {
    return false
  }
}

let ensureInflight: Promise<boolean> | null = null

/**
 * تضمین اجرای پروسهٔ LiveKit — فقط در محیطی که باینری بومی موجود است
 * (سندباکس توسعه). در استقرار واقعی با سرور رسانهٔ جداگانه، باینری نیست و
 * این تابع بی‌عمل به سلامت موجود بسنده می‌کند.
 */
export function ensureLivekitProcess(): Promise<boolean> {
  if (!ensureInflight) {
    ensureInflight = (async () => {
      if (await livekitHealthy()) return true
      const cwd = process.cwd()
      const bin = join(cwd, '.tools', 'livekit-server')
      const yaml = join(cwd, '.tools', 'livekit-dev.yaml')
      if (!existsSync(bin) || !existsSync(yaml)) {
        console.log('[media-selfheal] باینری/پیکربندی بومی LiveKit نیست — فقط بررسی سلامت')
        return livekitHealthy()
      }
      const apiKey = (process.env.LIVEKIT_API_KEY ?? '').trim()
      const apiSecret = (process.env.LIVEKIT_API_SECRET ?? '').trim()
      if (!apiKey || !apiSecret) {
        console.error('[media-selfheal] کلید API برای اجرای LiveKit موجود نیست')
        return false
      }
      try {
        // detached + unref معادل «( setsid nohup ... & )» — با پایان next زنده می‌ماند
        const logFd = openSync(join(cwd, 'livekit.log'), 'a')
        const child = (await import('child_process')).spawn(
          bin,
          ['--config', yaml],
          {
            env: { ...process.env, LIVEKIT_KEYS: `${apiKey}: ${apiSecret}` },
            detached: true,
            stdio: ['ignore', logFd, logFd],
          },
        )
        child.unref()
        console.log(`[media-selfheal] LiveKit spawn شد (pid=${child.pid}) — انتظار برای سلامت`)
      } catch (e) {
        console.error('[media-selfheal] spawn LiveKit ناموفق:', e)
        return false
      }
      // سقف ۸ ثانیه برای آماده‌شدن
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 400))
        if (await livekitHealthy()) {
          console.log('[media-selfheal] LiveKit سالم شد (:7880)')
          return true
        }
      }
      console.error('[media-selfheal] LiveKit بعد از spawn سالم نشد — livekit.log را ببینید')
      return false
    })().finally(() => {
      // قفل بعد از پایان آزاد می‌شود؛ فراخوانی بعدی دوباره بررسی واقعی می‌کند
      ensureInflight = null
    })
  }
  return ensureInflight
}

/**
 * پیکربندی آمادهٔ استفادهٔ رسانه — برای مسیرهای API توکن/وضعیت:
 * hydrate (در صورت نیاز) → تضمین پروسه → پیکربندی؛ null یعنی واقعاً
 * پیکربندی ممکن نشد (پیام ۵۰۳ فقط در این حالت به کاربر می‌رسد).
 */
export function externalMediaMode(): boolean {
  return !!(process.env.NEXT_PUBLIC_LIVEKIT_WS_URL ?? '').trim()
}

export async function ensureLivekitRuntime(): Promise<LivekitServerConfig | null> {
  if (externalMediaMode()) {
    const cfgExt = livekitServerConfig()
    return cfgExt.configured ? cfgExt : null
  }
  let cfg = livekitServerConfig()
  if (cfg.configured && (await livekitHealthy())) return cfg
  await hydrateEnvFromDisk()
  cfg = livekitServerConfig()
  if (!cfg.configured) return null
  const up = await ensureLivekitProcess()
  return up ? cfg : null
}

let bootDone = false

/**
 * قلاب بوت (instrumentation.register) — یک‌بار در بوت پروسهٔ nodejs:
 * ۱) hydrate env  ۲) تضمین LiveKit  ۳) نگهبان دوره‌ای اگر اجرا نیست.
 * هیچ‌گاه خطا به بوت next منتقل نمی‌کند؛ خودترمیم همیشه «بهترین تلاش» است.
 */
export function bootSelfHeal(): void {
  const g = globalThis as unknown as { __daniarSelfHealBoot?: boolean }
  if (bootDone || g.__daniarSelfHealBoot) return
  bootDone = true
  g.__daniarSelfHealBoot = true

  void (async () => {
    try {
      if (externalMediaMode()) {
        console.log('[media-selfheal] boot: رسانهٔ بیرونی (NEXT_PUBLIC_LIVEKIT_WS_URL) — سرور محلی مدیریت نمی‌شود')
        return
      }
      await hydrateEnvFromDisk()
      const ok = await ensureLivekitProcess()
      console.log(`[media-selfheal] boot: LiveKit ${ok ? 'سالم' : 'ناسالم'}`)
    } catch (e) {
      console.error('[media-selfheal] boot error:', e)
    }
  })()

  // نگهبان دوره‌ای — فقط وقتی از قبل اجرا نیست (الگوی pgrep، بدون pidfile)
  void (async () => {
    try {
      const cwd = process.cwd()
      const script = join(cwd, 'scripts', 'dev-watchdog.sh')
      if (!existsSync(script)) return
      const { stdout } = await execFileP('pgrep', ['-f', 'scripts/dev-watchdog\\.sh'], {
        timeout: 3000,
      }).catch(() => ({ stdout: '' }))
      if (stdout.trim() !== '') return
      const logFd = openSync(join(cwd, 'watchdog.log'), 'a')
      const child = (await import('child_process')).spawn(
        'bash',
        [script],
        { detached: true, stdio: ['ignore', logFd, logFd], cwd },
      )
      child.unref()
      console.log(`[media-selfheal] نگهبان دوره‌ای بالا آمد (pid=${child.pid})`)
    } catch (e) {
      console.error('[media-selfheal] watchdog spawn error:', e)
    }
  })()
}
