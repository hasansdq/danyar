'use client'

import { ThemeProvider } from 'next-themes'
import { ReactNode, useEffect } from 'react'

export function Providers({ children }: { children: ReactNode }) {
  // ثبت Service Worker برای PWA — فقط فایل‌های ایستا کش می‌شوند
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => null)
    }
    if (document.readyState === 'complete') onLoad()
    else {
      window.addEventListener('load', onLoad)
      return () => window.removeEventListener('load', onLoad)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  )
}
