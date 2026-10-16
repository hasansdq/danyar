import { promises as fsp } from 'fs'
import path from 'path'
import net from 'net'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { livekitServerConfig } from '@/lib/livekit'
import { livekitListRooms } from './livekit-admin'
import type { ServiceCheck, ServiceKey } from './types'

/**
 * بررسی‌های سرویس — همه سمت سرور و با مقصد از «تنظیمات معتبر» (env).
 * هیچ API برای بررسی URL دلخواه وجود ندارد.
 *
 * اصول:
 * - هر بررسی timeout صریح دارد؛ خرابی یکی مانع بقیه نمی‌شود
 * - موفقیت HTTP/توکن هرگز «موفقیت انتقال رسانه» اعلام نمی‌شود
 * - پیام‌ها فارسی، قابل فهم، بدون هیچ محرمانه‌ای
 */

const DB_TIMEOUT_MS = 4000
const SOCKET_TIMEOUT_MS = 5000
const LIVEKIT_TIMEOUT_MS = 6000
const TURN_TIMEOUT_MS = 4000

function ok(
  key: ServiceKey,
  label: string,
  startedAt: number,
  detail: string | null = null,
): ServiceCheck {
  return {
    key,
    label,
    status: 'ok',
    latencyMs: Date.now() - startedAt,
    checkedAt: Date.now(),
    error: null,
    hint: null,
    detail,
  }
}

function fail(
  key: ServiceKey,
  label: string,
  startedAt: number,
  error: string,
  hint: string,
): ServiceCheck {
  return {
    key,
    label,
    status: 'degraded',
    latencyMs: Date.now() - startedAt,
    checkedAt: Date.now(),
    error,
    hint,
    detail: null,
  }
}

function notConfigured(
  key: ServiceKey,
  label: string,
  detail: string,
  hint: string,
): ServiceCheck {
  return {
    key,
    label,
    status: 'not_configured',
    latencyMs: null,
    checkedAt: Date.now(),
    error: null,
    hint,
    detail,
  }
}

// ─── وب و API ───
// خودِ پاسخ‌دادن این API، سلامت وب/API را اثبات می‌کند؛ زمان پاسخ کل
// مجموعهٔ بررسی‌ها جداگانه اندازه‌گیری و گزارش می‌شود.

// ─── دیتابیس ───
async function checkDb(): Promise<ServiceCheck> {
  const t = Date.now()
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, DB_TIMEOUT_MS)
    return ok('db', 'دیتابیس', t)
  } catch (e) {
    return fail(
      'db',
      'دیتابیس',
      t,
      `پرس‌وجوی سبک ناموفق بود${safeReason(e)}`,
      'فایل/سرویس دیتابیس و مجوزهای مسیر آن را بررسی کنید',
    )
  }
}

// ─── فضای آپلود ───
function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

async function checkUpload(): Promise<ServiceCheck> {
  const t = Date.now()
  const dir = uploadDir()
  const name = `.infra-probe-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`
  const file = path.join(dir, name)
  try {
    await withTimeout(fsp.mkdir(dir, { recursive: true }), 3000)
    const marker = crypto.randomBytes(12).toString('hex')
    await withTimeout(fsp.writeFile(file, marker, { flag: 'wx' }), 4000)
    const readBack = await withTimeout(fsp.readFile(file, 'utf8'), 4000)
    if (readBack !== marker) throw new Error('محتوای فایل موقتی پس از خواندن مطابقت نداشت')
    return ok('upload', 'فضای آپلود', t, `خواندن و نوشتن موقت در مسیر آپلود موفق بود`)
  } catch (e) {
    return fail(
      'upload',
      'فضای آپلود',
      t,
      `نوشتن/خواندن فایل موقت در مسیر آپلود ناموفق بود${safeReason(e)}`,
      'مجوزهای نوشتن مسیر آپلود و فضای دیسک را بررسی کنید',
    )
  } finally {
    // پاک‌سازی تضمینی فایل موقتی اختصاصی — حتی در صورت خطا
    try {
      await fsp.rm(file, { force: true })
    } catch {
      /* تلاش پاک‌سازی؛ فایل wx یکتا و موقتی است */
    }
  }
}

// ─── سرویس Socket.IO پیام‌رسان ───
function socketInternalUrl(): string {
  return (process.env.SOCKET_INTERNAL_URL ?? 'http://127.0.0.1:3003').replace(/\/$/, '')
}

async function checkSocket(): Promise<ServiceCheck> {
  const t = Date.now()
  try {
    const res = await withTimeout(
      fetch(`${socketInternalUrl()}/healthz`, {
        // no-store: وضعیت لحظه‌ای، نه کش
        headers: { 'cache-control': 'no-store' },
        signal: AbortSignal.timeout(SOCKET_TIMEOUT_MS),
      }),
      SOCKET_TIMEOUT_MS,
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { db?: string } | null
      return fail(
        'socket',
        'سرویس پیام‌رسان (Socket.IO)',
        t,
        `سرویس سوکت پاسخ غیرسالم داد (کد ${res.status}${body?.db === 'error' ? '، اتصال دیتابیس سوکت خطا دارد' : ''})`,
        'لاگ سرویس socket را بررسی کنید؛ اگر دیتابیس خطا دارد اول همان را رفع کنید',
      )
    }
    const body = (await res.json().catch(() => ({}))) as {
      uptimeSec?: number
      clients?: number
    }
    const detail =
      typeof body.clients === 'number'
        ? `اتصالات فعال: ${body.clients}${typeof body.uptimeSec === 'number' ? ` — بالا از ${Math.floor(body.uptimeSec / 60)} دقیقه پیش` : ''}`
        : 'پاسخ healthz سالم بود'
    return ok('socket', 'سرویس پیام‌رسان (Socket.IO)', t, detail)
  } catch (e) {
    return fail(
      'socket',
      'سرویس پیام‌رسان (Socket.IO)',
      t,
      `دسترسی به سرویس سوکت برقرار نشد${safeReason(e)}`,
      'در اجرای Docker وضعیت سرویس socket را بررسی کنید؛ در VPS مستقیم، پروسهٔ سرویس سوکت را ببینید',
    )
  }
}

// ─── LiveKit ───
async function checkLivekit(): Promise<ServiceCheck> {
  const t = Date.now()
  const cfg = livekitServerConfig()
  if (!cfg.configured) {
    return notConfigured(
      'livekit',
      'سرور رسانه (LiveKit)',
      'کلیدهای LiveKit در تنظیمات محیط موجود نیست',
      'در استقرار Docker با پروفایل media کلیدها را در .env تنظیم کنید (توضیحات .env.example)',
    )
  }
  try {
    const list = await withTimeout(livekitListRooms(), LIVEKIT_TIMEOUT_MS)
    // آدرس مقصد هرگز در پاسخ نمی‌آید — فقط تعداد
    const count = list.rooms?.length ?? 0
    return ok(
      'livekit',
      'سرور رسانه (LiveKit)',
      t,
      `دسترسی مدیریتی معتبر است — ${count} اتاق فعال`,
    )
  } catch (e) {
    return fail(
      'livekit',
      'سرور رسانه (LiveKit)',
      t,
      `فراخوانی مدیریتی LiveKit ناموفق بود${safeReason(e)}`,
      'پروسه/کانتینر LiveKit و کلیدهای تنظیم‌شده را بررسی کنید؛ توجه: سلامت API مدیریتی به‌معنای سلامت انتقال رسانه نیست — آزمون اتصال رسانه را اجرا کنید',
    )
  }
}

// ─── TURN ───
/**
 * صرف وجود تنظیمات «سلامت» نیست — اینجا فقط تنظیم‌بودن و دسترسی TCP
 * مقصدِ تنظیم‌شده بررسی می‌شود؛ آزمون واقعی مسیر relay فقط با اقدام
 * مدیر در مرورگر انجام می‌شود (RTCPeerConnection با انتخاب مسیر relay).
 */
/**
 * استخراج میزبان/پورت TURN از تنظیمات — بدون URL دلخواه کاربر، فقط env.
 * قالب‌های پذیرفته: turn:host:3478 | turns:host:5349 | host standalone
 */
function turnConfigured(): { urls: string[]; host: string | null; port: number | null } {
  const urls = (process.env.LIVE_TURN_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  let host: string | null = null
  let port: number | null = null
  for (const u of urls) {
    const m = u.match(/^(?:turn|turns|udp|tcp):(?:\/\/)?([^:/?#\s\[]+)(?::(\d+))?/i)
    if (m) {
      host = m[1]
      const p = Number(m[2] ?? 3478)
      port = Number.isFinite(p) && p > 0 ? p : 3478
      break
    }
  }
  if (!host) {
    const h = (process.env.LIVEKIT_PUBLIC_TURN_HOST ?? '').trim()
    if (h) {
      host = h
      const p = Number(process.env.LIVEKIT_PUBLIC_TURN_PORT ?? 3478)
      port = Number.isFinite(p) && p > 0 ? p : 3478
    }
  }
  return { urls, host, port }
}

async function checkTurn(): Promise<ServiceCheck> {
  const t = Date.now()
  const { urls, host, port } = turnConfigured()
  if (urls.length === 0 && !host) {
    return notConfigured(
      'turn',
      'سرور TURN',
      'هیچ TURN در تنظیمات محیط ثبت نشده است',
      'در صورت نیاز، متغیرهای LIVE_TURN_* را در .env تنظیم کنید (اختیاری — برای شبکه‌های سختگیر)',
    )
  }
  // بررسی «بررسی‌پذیری»: اتصال TCP به مقصد تنظیم‌شده (بدون افشای رمز)
  if (!host || !port) {
    return {
      key: 'turn',
      label: 'سرور TURN',
      status: 'degraded',
      latencyMs: null,
      checkedAt: Date.now(),
      error: 'TURN تنظیم شده اما مقصد آن قابل استخراج نبود',
      hint: 'قالب LIVE_TURN_URLS را بررسی کنید (مثال: turn:host:3478)',
      detail: null,
    }
  }
  try {
    const started = Date.now()
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const s = net.createConnection({ host, port: port as number }, () => {
          s.destroy()
          resolve()
        })
        s.setTimeout(TURN_TIMEOUT_MS, () => {
          s.destroy()
          reject(new Error('timeout'))
        })
        s.on('error', (err) => {
          s.destroy()
          reject(err)
        })
      }),
      TURN_TIMEOUT_MS,
    )
    return ok(
      'turn',
      'سرور TURN',
      t,
      `تنظیم‌شده و مقصد پاسخ داد (${Date.now() - started}ms) — توجه: آزمون واقعی مسیر relay را از بخش «بررسی مرورگر» اجرا کنید`,
    )
  } catch (e) {
    return fail(
      'turn',
      'سرور TURN',
      t,
      `مقصد TURN در دسترس نبود${safeReason(e)}`,
      'پروسه/کانتینر coturn، پورت‌ها و فایروال را بررسی کنید — رسانه کلاس در شبکه‌های سختگیر ممکن است مختل شود',
    )
  }
}

/** اجرای همهٔ بررسی‌های سرویس به‌صورت موازی و ایزوله */
export async function runServiceChecks(): Promise<{
  checks: ServiceCheck[]
  totalLatencyMs: number
}> {
  const started = Date.now()
  const [db, upload, socket, livekit, turn] = await Promise.allSettled([
    checkDb(),
    checkUpload(),
    checkSocket(),
    checkLivekit(),
    checkTurn(),
  ])
  const unwrap = (p: PromiseSettledResult<ServiceCheck>, fallback: ServiceCheck) =>
    p.status === 'fulfilled'
      ? p.value
      : {
          ...fallback,
          status: 'degraded' as const,
          error: 'بررسی به خطای غیرمنتظره خورد',
          hint: 'لاگ سرور را بررسی کنید',
          latencyMs: null,
        }
  const fallbacks: Record<ServiceKey, ServiceCheck> = {
    web: {
      key: 'web',
      label: 'وب و API دانیار',
      status: 'unchecked',
      latencyMs: null,
      checkedAt: Date.now(),
      error: null,
      hint: null,
      detail: null,
    },
    db: { key: 'db', label: 'دیتابیس', status: 'unchecked', latencyMs: null, checkedAt: Date.now(), error: null, hint: null, detail: null },
    upload: { key: 'upload', label: 'فضای آپلود', status: 'unchecked', latencyMs: null, checkedAt: Date.now(), error: null, hint: null, detail: null },
    socket: { key: 'socket', label: 'سرویس پیام‌رسان (Socket.IO)', status: 'unchecked', latencyMs: null, checkedAt: Date.now(), error: null, hint: null, detail: null },
    livekit: { key: 'livekit', label: 'سرور رسانه (LiveKit)', status: 'unchecked', latencyMs: null, checkedAt: Date.now(), error: null, hint: null, detail: null },
    turn: { key: 'turn', label: 'سرور TURN', status: 'unchecked', latencyMs: null, checkedAt: Date.now(), error: null, hint: null, detail: null },
  }
  const checks: ServiceCheck[] = [
    // وب/API: پاسخ‌دادن همین اندپوینت = سالم؛ latency کل مجموعه
    {
      key: 'web',
      label: 'وب و API دانیار',
      status: 'ok',
      latencyMs: null, // کل بعد از پایان همهٔ بررسی‌ها پر می‌شود
      checkedAt: Date.now(),
      error: null,
      hint: null,
      detail: 'پاسخ‌گویی API سرور (همین بررسی) تأیید شد',
    },
    unwrap(db, fallbacks.db),
    unwrap(upload, fallbacks.upload),
    unwrap(socket, fallbacks.socket),
    unwrap(livekit, fallbacks.livekit),
    unwrap(turn, fallbacks.turn),
  ]
  const totalLatencyMs = Date.now() - started
  checks[0].latencyMs = totalLatencyMs
  return { checks, totalLatencyMs }
}

// ─── ابزارهای مشترک ───
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(` (مهلت ${ms}ms سپری شد)`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** دلیل امن خطا — فقط نام/کد کوتاه؛ هرگز پیام کامل با محرمانه */
function safeReason(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message
    // قطع‌های شبکه/مهلت — بی‌خطر و کوتاه
    if (/timeout|abort|TIMEOUT/i.test(msg)) return ' (مهلت پاسخ سپری شد)'
    if (/ECONNREFUSED/i.test(msg)) return ' (مقصد اتصال را رد کرد)'
    if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return ' (نام مقصد حل نشد)'
    if (/EACCES|EPERM/i.test(msg)) return ' (خطای مجوز)'
    if (/ENOSPC/i.test(msg)) return ' (فضای دیسک کافی نیست)'
    if (/SQLITE|P2021|P2022|P1001/i.test(msg)) return ` (خطای دیتابیس: ${msg.slice(0, 60)})`
    return ` (${msg.slice(0, 80)})`
  }
  return ''
}

export { turnConfigured }
