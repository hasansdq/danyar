'use client'

import { useEffect, useState } from 'react'
import { SplashView } from '@/components/splash-view'
import type { Branding } from '@/lib/use-branding'

/**
 * اسپلش اسکرین دانیار — پیش از ورود به برنامه (روی هر بارگذاری تازه صفحه)
 * همه چیز از تنظیمات مدیر کل می‌آید: مدت نمایش، متن‌ها، امکان حذف هر متن
 * و تصویر پس‌زمینه سفارشی. داده‌ها از سرور (root layout) بدون درخواست اضافه.
 */

const STORAGE_KEY = 'daniar-splash-at'

export function SplashGate({ branding }: { branding: Branding }) {
  const [visible, setVisible] = useState(false)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const s = branding.splash
    if (!s?.enabled) return
    // در هر بارگذاری تازه صفحه نمایش داده می‌شود؛ برای پیمایش داخلی (SPA) تکرار نمی‌شود
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') return
      sessionStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setVisible(true)
    const fadeAt = Math.max(300, s.durationMs - 350)
    const t1 = setTimeout(() => setFading(true), fadeAt)
    const t2 = setTimeout(() => setVisible(false), s.durationMs + 100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [branding])

  if (!visible) return null

  return (
    <div style={{ opacity: fading ? 0 : 1, transition: 'opacity .3s' }}>
      <SplashView
        appName={branding.appName}
        schoolDisplayName={branding.schoolDisplayName}
        splash={branding.splash}
      />
    </div>
  )
}
