'use client'

import { useEffect, useState } from 'react'

/**
 * هوک برندینگ — نام اپ، لوگو، فونت و اسپلش (کش ماژولی؛ یک درخواست برای کل صفحه)
 */

export interface Branding {
  appName: string
  logoUrl: string | null
  schoolDisplayName: string | null
  splash: {
    enabled: boolean
    durationMs: number
    showAppName: boolean
    showDisplayName: boolean
    bgUrl: string | null
    appNameFont: string
    appNameColor: string
    appNameSize: number
    displayNameFont: string
    displayNameColor: string
    displayNameSize: number
  }
  chatBgUrl: string | null
  chatBgDarkUrl: string | null
}

let cache: Branding | null = null
let inflight: Promise<Branding> | null = null

export function clearBrandingCache() {
  cache = null
  inflight = null
}

async function loadBranding(): Promise<Branding> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetch('/api/branding', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        cache = d as Branding
        return cache
      })
      .catch(() => ({
        appName: 'دانیار',
        logoUrl: null,
        schoolDisplayName: null,
        splash: {
          enabled: false,
          durationMs: 2200,
          showAppName: true,
          showDisplayName: true,
          bgUrl: null,
          appNameFont: '',
          appNameColor: '#0f766e',
          appNameSize: 56,
          displayNameFont: '',
          displayNameColor: '#475569',
          displayNameSize: 16,
        },
        chatBgUrl: null,
        chatBgDarkUrl: null,
      })) as Promise<Branding>
  }
  return inflight
}

export function useBranding(): Branding | null {
  const [branding, setBranding] = useState<Branding | null>(cache)
  useEffect(() => {
    let alive = true
    void loadBranding().then((b) => {
      if (alive) setBranding(b)
    })
    return () => {
      alive = false
    }
  }, [])
  return branding
}
