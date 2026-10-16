'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * حالت تمام‌صفحه سازگار با همه دستگاه‌ها — موبایل، تبلت و دسکتاپ.
 *
 * - مرورگرهای استاندارد + iPad Safari (webkitRequestFullscreen): Fullscreen API واقعی
 * - iPhone Safari (بدون پشتیبانی Fullscreen API برای المان): حالت تمام‌صفحهٔ
 *   شبه‌سازگار با fixed inset-0 روی همان المان (fake mode)
 * - wantLandscape: هنگام ورود، قفل جهت افقی تلاش می‌شود (اندروید در حالت fullscreen)؛
 *   اگر مرورگر/دستگاه قفل جهت نداشت، مصرف‌کننده با usePortrait خودش چرخش CSS اعمال می‌کند.
 *
 * استفاده: <div ref={fs.attach}> … <button onClick={fs.toggle}>
 * خروج: دکمه toggle / ESC / ژست بازگشت اندروید → fullscreenchange همگام می‌شود
 */
export function useFullscreenElement<
  T extends HTMLElement = HTMLDivElement,
>(wantLandscape = false) {
  // المان مقصد در state نگه داشته می‌شود (بدون ref) — یک رندر اضافه هنگام mount
  const [node, setNode] = useState<T | null>(null)
  const [active, setActive] = useState(false)
  const [fake, setFake] = useState(false)

  const attach = useCallback((n: T | null) => setNode(n), [])

  // همگام‌سازی با خروج سیستم‌محور (ESC / دکمه بازگشت اندروید)
  useEffect(() => {
    if (fake || !node) return
    const onChange = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement ??
        null
      setActive(!!fsEl && fsEl === node)
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [fake, node])

  const lockLandscape = useCallback(async () => {
    if (!wantLandscape) return
    try {
      const orientation = screen.orientation as
        | (ScreenOrientation & {
            lock?: (o: 'landscape' | 'portrait' | string) => Promise<void>
          })
        | undefined
      if (orientation?.lock) {
        await orientation.lock('landscape')
      }
    } catch {
      /* قفل جهت پشتیبانی نمی‌شود — مصرف‌کننده چرخش CSS می‌دهد */
    }
  }, [wantLandscape])

  const enter = useCallback(async () => {
    if (!node) return
    const anyEl = node as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void
    }
    try {
      if (node.requestFullscreen) {
        await node.requestFullscreen()
        await lockLandscape()
        return
      }
      if (anyEl.webkitRequestFullscreen) {
        await anyEl.webkitRequestFullscreen()
        await lockLandscape()
        return
      }
    } catch {
      /* ادامه به fake mode */
    }
    // iPhone Safari و مرورگرهای بدون Fullscreen API
    setFake(true)
    setActive(true)
  }, [node, lockLandscape])

  const exit = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement &&
        (document as Document & { webkitExitFullscreen?: () => void })
          .webkitExitFullscreen
      ) {
        ;(
          document as Document & { webkitExitFullscreen?: () => void }
        ).webkitExitFullscreen!()
      }
    } catch {
      /* ignore */
    }
    try {
      screen.orientation?.unlock?.()
    } catch {
      /* ignore */
    }
    setFake(false)
    setActive(false)
  }, [])

  const toggle = useCallback(() => {
    if (active) void exit()
    else void enter()
  }, [active, enter, exit])

  return { attach, active, fake, enter, exit, toggle }
}

/** تشخیص عمودی بودن صفحه — برای چرخش CSS ویدیوی افقی در موبایل عمودی */
export function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const apply = () => setPortrait(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return portrait
}
