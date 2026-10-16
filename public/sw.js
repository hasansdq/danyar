/**
 * Service Worker دانیار — کش فقط فایل‌های ایستا + پوش نوتیفیکیشن واقعی مرورگر.
 * هیچ پاسخ API یا صفحه خصوصی در کش ذخیره نمی‌شود (حفظ حریم خصوصی حساب‌ها).
 * محدوده (scope): / — کل وب‌اپ را پوشش می‌دهد.
 *
 * ⚠️ فایل‌های /_next/static/ هرگز کش نمی‌شوند: در حالت توسعه (و HMR) نام چانک‌ها
 * بدون هش است و با هر به‌روزرسانی حذف/جایگزین می‌شود؛ کش‌کردن آن‌ها باعث ارور
 * «module factory is not available … deleted in an HMR update» می‌شود.
 * در پروداکشن نیز Next.js خودش هدر Cache-Control: immutable می‌دهد و کش HTTP
 * مرورگر کافی است — نیازی به کش SW نیست.
 */
const STATIC_CACHE = 'daniar-static-v2'
const STATIC_ASSETS = [
  '/daniar-logo.svg',
  '/fonts/Vazirmatn-Variable.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => null),
  )
  self.skipWaiting()
})

// دست‌دادن نسخه: صفحه از سرویس‌ورکر فعال نسخه کش را می‌پرسد.
// اگر سرویس‌ورکر کهنه (نسخه‌های قبلی) پاسخ ندهد، صفحه خود را ترمیم می‌کند
// (لغو ثبت SW + پاک‌سازی کش‌ها + نوسازی) — رفع خودکار حالت‌های گیرکرده قدیمی
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'DANIAR_SW_VERSION' && event.ports && event.ports[0]) {
    try {
      event.ports[0].postMessage({ type: 'DANIAR_SW_VERSION', version: STATIC_CACHE })
    } catch {
      /* ignore */
    }
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then(async (keys) => {
        // کش نسخه‌های قدیمی حذف می‌شود؛ اگر چیزی پاک شد به صفحه‌ها خبر می‌دهیم
        // تا یک‌بار خود را نوسازی کنند (رفع خودکار حالت‌های گیرکرده قدیمی)
        const stale = keys.filter((k) => k !== STATIC_CACHE)
        await Promise.all(stale.map((k) => caches.delete(k)))
        if (stale.length > 0) {
          const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          for (const client of list) {
            try {
              client.postMessage({ type: 'DANIAR_SW_PURGED' })
            } catch {
              /* ignore */
            }
          }
        }
      })
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET') return

  // هیچ‌گاه API، پیام‌ها یا داده خصوصی کش نمی‌شود — همیشه شبکه
  if (url.pathname.startsWith('/api/')) return

  // صفحات و مسیرهای خصوصی: همیشه شبکه (بدون کش)
  if (event.request.mode === 'navigate') return

  // فونت و آیکون و تصاویر ایستا: cache-first
  // توجه: /_next/static/ عمداً کش نمی‌شود — توضیح در بالای فایل
  if (
    url.pathname.startsWith('/fonts/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/daniar-logo.svg' ||
    url.pathname === '/logo.svg'
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            const copy = res.clone()
            caches.open(STATIC_CACHE).then((c) => c.put(event.request, copy)).catch(() => null)
            return res
          }),
      ),
    )
  }
})

// ─── پوش نوتیفیکیشن واقعی (Web Push) ───

self.addEventListener('push', (event) => {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch {
    data = null
  }
  // بسته نامعتبر/بدون عنوان: اعلان خالی نمایش داده نمی‌شود
  if (!data || typeof data.title !== 'string' || !data.title) return

  event.waitUntil(handlePushMessage(data))
})

async function handlePushMessage(data) {
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    dir: 'rtl',
    lang: 'fa',
    // پیام‌های متوالی یک گفتگو با tag یکسان جایگزین می‌شوند (تجمیع)
    tag: typeof data.tag === 'string' && data.tag ? data.tag : 'daniar',
    data: { link: typeof data.link === 'string' && data.link ? data.link : '/notifications' },
    requireInteraction: false,
    silent: false,
  }

  // ۱) اگر همین گفتگو در پنجره فعال دیده می‌شود → اعلان سیستم لازم نیست
  if (
    typeof data.conversationKey === 'string' &&
    data.conversationKey &&
    (await isAnyFocusedClientViewing(data.conversationKey))
  ) {
    return
  }
  // ۲) اگر هر پنجره دانیار فعال (focus) است، اعلان سیستم تکراری نمی‌سازیم؛
  //    زنگ اعلان درون‌برنامه‌ای همان رویداد را نشان می‌دهد
  if (await hasFocusedClient()) return

  await self.registration.showNotification(data.title, options)
}

function allWindowClients() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
}

async function hasFocusedClient() {
  const list = await allWindowClients()
  return list.some((c) => c.focused)
}

/** پرس‌وجو از پنجره‌های باز: آیا همین گفتگو الان باز است؟ */
function askClientViewing(client, conversationKey) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(false), 500)
    channel.port1.onmessage = (e) => {
      clearTimeout(timer)
      resolve(!!(e.data && e.data.viewing))
    }
    try {
      client.postMessage({ type: 'DANIAR_VIEWING_CHECK', conversationKey }, [channel.port2])
    } catch {
      clearTimeout(timer)
      resolve(false)
    }
  })
}

async function isAnyFocusedClientViewing(conversationKey) {
  const list = await allWindowClients()
  if (!list.length) return false
  const answers = await Promise.all(list.map((c) => askClientViewing(c, conversationKey)))
  return answers.some(Boolean)
}

// ─── کلیک روی اعلان: پنجره باز فوکوس و هدایت می‌شود؛ پنجره اضافه ساخته نمی‌شود ───

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link =
    (event.notification.data && typeof event.notification.data.link === 'string'
      ? event.notification.data.link
      : '') || '/notifications'

  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // پنجره باز دانیار → همان پنجره فعال و هدایت می‌شود
      for (const client of list) {
        if (client.url && client.url.startsWith(self.location.origin)) {
          try {
            if ('focus' in client) await client.focus()
          } catch {
            /* ignore */
          }
          client.postMessage({ type: 'DANIAR_NAVIGATE', link })
          return
        }
      }
      // پنجره‌ای باز نیست → مقصد باز می‌شود؛ اگر کاربر وارد نباشد
      // سرور به /login?next=… هدایت می‌کند و پس از ورود به مقصد می‌رسد
      await self.clients.openWindow(link)
    })(),
  )
})
