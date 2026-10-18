'use client'

/**
 * نصب دانیار به‌عنوان اپ موبایل از مرورگر (درخواست کاربر):
 * - اندروید/کروم/اج: رویداد beforeinstallprompt گرفته می‌شود و دکمهٔ «نصب برنامه»
 *   دیالوگ نصب原生 مرورگر را باز می‌کند
 * - iOS سافاری: دیالوگ نصب وجود ندارد — راهنمای «اشتراک ← افزودن به صفحهٔ اصلی»
 * - حالت standalone (نصب‌شده) تشخیص داده می‌شود
 */

import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaInstallState {
  /** مرورگر دیالوگ نصب پشتیبانی می‌کند و رویداد آن گرفته شده است */
  canInstall: boolean
  /** اجرای دیالوگ نصب — خروجی: 'accepted' | 'dismissed' | null */
  install: () => Promise<'accepted' | 'dismissed' | null>
  /** برنامه همین حالا نصب‌شده اجرا شده است (standalone) */
  standalone: boolean
  /** iOS سافاری/آیفون — نیاز به راهنمای «افزودن به صفحهٔ اصلی» */
  isIos: boolean
}

export function usePwaInstall(): PwaInstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIos, setIsIos] = useState(false)
  const [standalone, setStandalone] = useState(false)

  useEffect(() => {
    const syncDisplayState = () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const sa =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      setIsIos(ios)
      setStandalone(sa)
    }
    syncDisplayState()

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener('change', syncDisplayState)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      mq.removeEventListener('change', syncDisplayState)
    }
  }, [])

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | null> => {
    if (!deferred) return null
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      return choice.outcome
    } catch {
      return null
    } finally {
      setDeferred(null)
    }
  }, [deferred])

  return { canInstall: Boolean(deferred), install, standalone, isIos }
}
