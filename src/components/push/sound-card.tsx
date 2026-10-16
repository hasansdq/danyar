'use client'

import { useEffect, useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/hooks/use-toast'

/**
 * تنظیم صدای هشدار پاپ‌آپ «کلاس شما شروع شد!» — اختیاری؛
 * نمایش پاپ‌آپ به این تنظیم وابسته نیست و محدودیت مرورگر (پخش خودکار)
 * مستقل از این تنظیم هم رعایت می‌شود.
 */
export function SoundAlertCard() {
  const [soundEnabled, setSoundEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/me/notification-prefs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setSoundEnabled(d.soundEnabled !== false)
      })
      .catch(() => alive && setSoundEnabled(true))
    return () => {
      alive = false
    }
  }, [])

  async function toggle(v: boolean) {
    setSaving(true)
    const prev = soundEnabled
    setSoundEnabled(v)
    try {
      const r = await fetch('/api/me/notification-prefs', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ soundEnabled: v }),
      })
      if (!r.ok) throw new Error()
      toast({ title: v ? 'صدای هشدار روشن شد' : 'صدای هشدار خاموش شد' })
    } catch {
      setSoundEnabled(prev)
      toast({ title: 'ذخیره تنظیم ناموفق بود', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Volume2 className="h-4.5 w-4.5 text-primary" />
          صدای هشدار شروع کلاس
        </CardTitle>
        <CardDescription>
          هنگام نمایش پاپ‌آپ «کلاس شما شروع شد!» یک زنگ کوتاه پخش می‌شود. نمایش پاپ‌آپ
          به این صدا وابسته نیست؛ اگر مرورگر پخش خودکار صدا را مجاز نداند، پاپ‌آپ بدون
          صدا نمایش داده می‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {soundEnabled === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">
              {soundEnabled ? 'صدا روشن است' : 'صدا خاموش است'}
            </span>
            <div className="flex items-center gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Switch
                checked={soundEnabled}
                disabled={saving}
                onCheckedChange={toggle}
                aria-label="صدای هشدار شروع کلاس"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
