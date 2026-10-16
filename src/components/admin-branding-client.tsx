'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Palette, Upload, Loader2, Type } from 'lucide-react'
import { clearBrandingCache } from '@/lib/use-branding'
import { PRESET_FONTS } from '@/lib/fonts'

/**
 * پنل هویت دانیار (مدیر کل): نام اپلیکیشن + لوگو
 * نام نمایشی هر مدرسه خودکار با الگوی «مدرسه هوشمند + نام مدرسه» ساخته می‌شود.
 */

interface SettingsShape {
  appName: string
  logoKey: string | null
}

export function AdminBrandingClient() {
  const [appName, setAppName] = useState('')
  const [logoKey, setLogoKey] = useState<string | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/admin/branding', { cache: 'no-store' })
      if (res.ok) {
        const d = (await res.json()).settings as SettingsShape
        setAppName(d.appName)
        setLogoKey(d.logoKey)
        setLogoPreview(d.logoKey ? `/api/branding/asset/${d.logoKey.split('/')[1]}` : null)
      }
      setLoading(false)
    })()
  }, [])

  async function uploadLogo(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/admin/branding/upload?type=logo', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) {
        toast.error(d.error ?? 'آپلود لوگو ناموفق بود')
        return
      }
      setLogoKey(d.key)
      setLogoPreview(d.url)
      toast.success('لوگو آپلود شد — برای اعمال، ذخیره کنید')
    } finally {
      setUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName, logoKey }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast.error(d.error ?? 'ذخیره ناموفق بود')
        return
      }
      clearBrandingCache()
      toast.success('هویت دانیار ذخیره شد')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-3 py-5 sm:px-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          هویت دانیار
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          نام اپلیکیشن و لوگو در کل برنامه (تیتر صفحات، سایدبار، صفحه ورود و اسپلش) اعمال می‌شود.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Type className="h-4 w-4 text-primary" />
            نام اپلیکیشن
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            maxLength={40}
            placeholder="مثلاً: دانیار"
          />
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground leading-6">
            نام نمایشی هر مدرسه به‌صورت خودکار با الگوی ثابت ساخته می‌شود:
            <div className="mt-1 font-bold text-foreground">
              مدرسه هوشمند + نام مدرسه — مثال: مدرسه هوشمند شهید بهشتی
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">لوگوی برنامه</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl border bg-card flex items-center justify-center overflow-hidden shrink-0">
              {logoPreview ? (
                <img src={logoPreview} alt="لوگو" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] text-muted-foreground">بدون لوگو</span>
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={logoInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,.gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadLogo(f)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => logoInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                آپلود لوگو
              </Button>
              <p className="text-[11px] text-muted-foreground">
                PNG/JPG/WebP/SVG/GIF — حداکثر ۲MB
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        ذخیره هویت
      </Button>
    </div>
  )
}
