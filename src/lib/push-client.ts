'use client'

/**
 * کمک‌کارهای سمت مرورگر برای پوش نوتیفیکیشن واقعی (Web Push + Service Worker).
 * تشخیص واقعی قابلیت دستگاه، فعال‌سازی با رضایت صریح کاربر، لغو اشتراک.
 * محدودیت‌های مرورگر/سیستم‌عامل به‌صورت شفاف گزارش می‌شود — تضمین تحویل وجود ندارد.
 */

export type PushSupportState =
  | 'SUPPORTED' // آماده فعال‌سازی
  | 'PERMISSION_DENIED' // مجوز قبلاً رد شده — فقط از تنظیمات مرورگر
  | 'UNSUPPORTED_SECURE_CONTEXT' // خارج از HTTPS
  | 'UNSUPPORTED_BROWSER' // PushManager / Service Worker ندارد
  | 'IOS_NEEDS_INSTALL' // iOS: ابتدا باید وب‌اپ نصب شود
  | 'SERVER_NOT_CONFIGURED' // کلید VAPID سرور تنظیم نشده

export interface PushSupport {
  state: PushSupportState
  isIOS: boolean
  iosStandalone: boolean
  browserHint: string
}

function detectBrowser(): string {
  const ua = navigator.userAgent
  if (/edg\//i.test(ua)) return 'Edge'
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return 'Opera'
  if (/firefox/i.test(ua)) return 'Firefox'
  if (/chrome|crios/i.test(ua)) return 'Chrome'
  if (/safari/i.test(ua)) return 'Safari'
  return 'مرورگر شما'
}

export function detectPushSupport(): PushSupport {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const iosStandalone =
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  const secure = window.isSecureContext
  const hasApi =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  const browser = detectBrowser()

  if (!secure) {
    return {
      state: 'UNSUPPORTED_SECURE_CONTEXT',
      isIOS,
      iosStandalone,
      browserHint: 'پوش نوتیفیکیشن فقط روی آدرس HTTPS امن کار می‌کند.',
    }
  }
  if (isIOS && !iosStandalone) {
    return {
      state: 'IOS_NEEDS_INSTALL',
      isIOS,
      iosStandalone,
      browserHint:
        'در iOS دریافت پوش فقط برای وب‌اپ نصب‌شده ممکن است: در سافاری دکمه اشتراک‌گذاری ← «Add to Home Screen» را بزنید و برنامه نصب‌شده را باز کنید (iOS 16.4 به بالا).',
    }
  }
  if (!hasApi) {
    return {
      state: 'UNSUPPORTED_BROWSER',
      isIOS,
      iosStandalone,
      browserHint:
        isIOS && iosStandalone
          ? 'این نسخه iOS از پوش وب پشتیبانی نمی‌کند (iOS 16.4 به بالا لازم است).'
          : 'مرورگر شما از Service Worker یا Push API پشتیبانی نمی‌کند.',
    }
  }
  if (Notification.permission === 'denied') {
    return {
      state: 'PERMISSION_DENIED',
      isIOS,
      iosStandalone,
      browserHint: buildBlockedGuide(browser, isIOS),
    }
  }
  return { state: 'SUPPORTED', isIOS, iosStandalone, browserHint: '' }
}

/** راهنمای فعال‌سازی مجوز مسدودشده — بدون تکرار درخواست مجوز */
export function buildBlockedGuide(browser: string, isIOS: boolean): string {
  if (isIOS) {
    return 'مجوز اعلان مسدود است. در تنظیمات iOS: Settings ← Safari (یا برنامه وب‌اپ) ← Notifications ← Allow. یا Settings ← Notifications ← همین برنامه را Allow کنید.'
  }
  switch (browser) {
    case 'Chrome':
    case 'Edge':
    case 'Opera':
      return `مجوز اعلان مسدود شده است. در ${browser}: روی آیکون قفل/تنظیمات کنار آدرس سایت کلیک کنید ← Permissions ← Notifications ← Allow. یا از Settings ← Privacy ← Site Settings ← Notifications آن را فعال کنید.`
    case 'Firefox':
      return 'مجوز اعلان مسدود شده است. روی آیکون قفل کنار آدرس کلیک کنید ← «Clear permission» یا در Preferences ← Privacy & Security ← Permissions ← Notifications تنظیم کنید.'
    case 'Safari':
      return 'مجوز اعلان مسدود شده است. در Safari: Settings ← Websites ← Notifications ← دانیار را Allow کنید.'
    default:
      return 'مجوز اعلان در تنظیمات این سایت برای این مرورگر مسدود است؛ از تنظیمات سایت در مرورگر آن را Allow کنید.'
  }
}

// ─── ابزارها ───

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem('push-device-id')
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem('push-device-id', id)
    }
    return id
  } catch {
    return 'unknown-device'
  }
}

function deviceLabel(): string {
  const browser = detectBrowser()
  const platform =
    /android/i.test(navigator.userAgent)
      ? 'Android'
      : /iphone|ipad|ipod/i.test(navigator.userAgent)
        ? 'iOS'
        : /mac/i.test(navigator.platform)
          ? 'macOS'
          : /win/i.test(navigator.platform)
            ? 'Windows'
            : /linux/i.test(navigator.platform)
              ? 'Linux'
              : 'دستگاه'
  return `${browser} / ${platform}`
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  let reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready
  return reg
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) return null
  return (await reg.pushManager.getSubscription()) ?? null
}

export interface SubscribeResult {
  ok: boolean
  error?: string
}

/** فعال‌سازی کامل: مجوز مرورگر + اشتراک + ثبت روی سرور */
export async function activatePushOnThisDevice(publicKey: string): Promise<SubscribeResult> {
  try {
    // درخواست مجوز فقط اینجا و فقط با کلیک کاربر انجام می‌شود
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      return {
        ok: false,
        error:
          permission === 'denied'
            ? 'مجوز اعلان رد شد؛ می‌توانید بعداً از تنظیمات مرورگر فعال کنید.'
            : 'مجوز اعلان داده نشد.',
      }
    }

    const reg = await ensureRegistration()
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      }))

    const json = sub.toJSON()
    const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string }
    if (!json.endpoint || !keys.p256dh || !keys.auth) {
      return { ok: false, error: 'اشتراک مرورگر ناقص است.' }
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        deviceId: getDeviceId(),
        label: deviceLabel(),
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      return { ok: false, error: d?.error ?? 'ثبت اشتراک روی سرور ناموفق بود.' }
    }
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'خطای نامشخص'
    if (/permission/i.test(msg)) {
      return { ok: false, error: 'مجوز اعلان رد شد؛ از تنظیمات مرورگر می‌توانید فعال کنید.' }
    }
    return { ok: false, error: `فعال‌سازی پوش ناموفق بود (${msg})` }
  }
}

/** غیرفعال‌سازی پوش همین دستگاه: حذف اشتراک روی سرور + مرورگر */
export async function deactivatePushOnThisDevice(): Promise<boolean> {
  try {
    const sub = await getExistingSubscription()
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => null)
      await sub.unsubscribe().catch(() => null)
    }
    return true
  } catch {
    return false
  }
}

/** پاک‌سازی اتصال اشتراک این دستگاه به حساب، هنگام خروج (قبل از پاک‌شدن کوکی) */
export async function pushLogoutCleanup(): Promise<void> {
  try {
    const sub = await getExistingSubscription()
    if (!sub) return
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      keepalive: true,
    })
  } catch {
    /* ignore */
  }
}
