'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { checkSwVersion } from '@/lib/sw-repair'

/**
 * پل ارتباطی صفحه با Service Worker برای پوش نوتیفیکیشن:
 * - پاسخ به «آیا همین گفتگو باز است؟» → جلوگیری از اعلان تکراری روی گفتگوی جاری
 * - هدایت پنجره فعال به مقصد اعلان بدون ساختن پنجره اضافه (DANIAR_NAVIGATE)
 * - بررسی نسخهٔ SW هنگام بارگذاری → ترمیم خودکار SW/کش کهنه (گیرکردن «درحال اتصال»)
 */
export function PushRuntimeBridge() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // ترمیم خودکار سرویس‌ورکر کهنه — یک‌بار در هر بارگذاری صفحه، با گارد داخلی
    void checkSwVersion()

    // کلید گفتگوی جاری از مسیر فعال استخراج می‌شود
    const conversationKeyOfPath = (p: string | null): string | null => {
      if (!p) return null
      const dm = p.match(/^\/chats\/dm\/([A-Za-z0-9_-]+)/)
      if (dm) return `dm:${dm[1]}`
      const gr = p.match(/^\/chats\/group\/([A-Za-z0-9_-]+)/)
      if (gr) return `group:${gr[1]}`
      return null
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; conversationKey?: string; link?: string } | null
      if (!data || typeof data.type !== 'string') return

      if (data.type === 'DANIAR_VIEWING_CHECK') {
        const current = conversationKeyOfPath(pathname)
        const viewing = !!current && current === data.conversationKey
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ viewing })
        }
        return
      }

      if (data.type === 'DANIAR_SW_PURGED') {
        // SW جدید کش قدیمی را پاک کرده — یک‌بار نوسازی صفحه تا چانک‌های
        // منقضی‌شده (ارور module factory) از بین بروند؛ فقط یک‌بار
        const KEY = 'daniar-sw-purge-reload'
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, '1')
          window.location.reload()
        }
        return
      }

      if (data.type === 'DANIAR_NAVIGATE') {
        const link = typeof data.link === 'string' ? data.link : '/notifications'
        // فقط مسیر داخلی مجاز است
        if (link.startsWith('/') && !link.startsWith('//')) {
          router.push(link)
        } else {
          router.push('/notifications')
        }
      }
    }

    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [pathname, router])

  return null
}
