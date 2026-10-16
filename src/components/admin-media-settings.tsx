'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { toast } from 'sonner'
import { Save, ShieldCheck, HardDrive } from 'lucide-react'
import { faNum } from '@/lib/format'
import { formatBytes } from '@/lib/media-format'
import type { MediaFormatSetting } from '@/lib/media'
import { cn } from '@/lib/utils'

interface SchoolQuotaRow {
  id: string
  name: string
  isActive: boolean
  mediaQuotaGB: number
  usageBytes: number
  fileCount: number
}

const FORMAT_ROWS: { key: string; label: string; hint: string }[] = [
  { key: 'IMAGE', label: 'تصویر', hint: 'jpg، png و…' },
  { key: 'AUDIO', label: 'صوت', hint: 'mp3، ogg و…' },
  { key: 'VIDEO', label: 'ویدئو', hint: 'mp4، webm و…' },
  { key: 'FILE', label: 'فایل', hint: 'pdf، docx، zip و…' },
]

/**
 * تب «تنظیمات» مدیریت رسانه‌ها — فرمت‌های مجاز آپلود با سقف حجم هر فرمت،
 * و سهمیه آپلود کل هر مدرسه بر حسب گیگابایت (۰ = نامحدود)
 */
export function AdminMediaSettings() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formats, setFormats] = useState<MediaFormatSetting[]>([])
  const [extText, setExtText] = useState<Record<string, string>>({})
  const [schools, setSchools] = useState<SchoolQuotaRow[]>([])
  const [quotaText, setQuotaText] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/media/settings')
      if (!r.ok) {
        toast.error('خطا در دریافت تنظیمات رسانه')
        return
      }
      const d = await r.json()
      const f: MediaFormatSetting[] = d.formats ?? []
      setFormats(f)
      setExtText(
        Object.fromEntries(f.map((x) => [x.format, x.extensions.join('، ')])),
      )
      const s: SchoolQuotaRow[] = d.schools ?? []
      setSchools(s)
      setQuotaText(Object.fromEntries(s.map((x) => [x.id, String(x.mediaQuotaGB)])))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    try {
      // ساخت فرمت‌ها از ورودی‌ها
      const payloadFormats = formats.map((f) => {
        const extensions = (extText[f.format] ?? '')
          .split(/[،,\s]+/)
          .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
          .filter(Boolean)
        return { ...f, extensions }
      })
      for (const f of payloadFormats) {
        if (!f.extensions.length) {
          toast.error(`حداقل یک پسوند برای فرمت ${f.format} لازم است`)
          return
        }
        const mb = Number(f.maxMB)
        if (!Number.isFinite(mb) || mb < 1) {
          toast.error(
            `سقف حجم ${FORMAT_ROWS.find((r) => r.key === f.format)?.label ?? f.format} باید عددی بزرگ‌تر از صفر باشد`,
          )
          return
        }
      }
      const quotas: Record<string, number> = {}
      for (const s of schools) {
        const gb = Number(quotaText[s.id] ?? '0')
        if (!Number.isFinite(gb) || gb < 0) {
          toast.error(`سهمیه مدرسه «${s.name}» نامعتبر است`)
          return
        }
        quotas[s.id] = gb
      }

      const r = await fetch('/api/admin/media/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ formats: payloadFormats, quotas }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) {
        toast.error(d?.error ?? 'ذخیره تنظیمات ناموفق بود')
        return
      }
      toast.success('تنظیمات رسانه ذخیره شد و از همین لحظه برای همه آپلودها اعمال می‌شود')
      load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-4 space-y-3">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-5">
      {/* ─── فرمت‌های مجاز ─── */}
      <section className="rounded-xl border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-bold text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            فرمت‌های مجاز آپلود و سقف حجم هر فرمت
          </h2>
          <p className="text-xs text-muted-foreground mt-1 leading-5">
            این سیاست برای همه آپلودهای پلتفرم (گفتگو، تکالیف و نمونه‌سؤال) اعمال می‌شود؛
            تصویر پروفایل فقط از نظر سقف حجم تابع همین تنظیمات است.
          </p>
        </div>
        <div className="space-y-3">
          {formats.map((f) => {
            const row = FORMAT_ROWS.find((r) => r.key === f.format)
            return (
              <div
                key={f.format}
                className={cn(
                  'rounded-lg border p-3 flex flex-wrap items-center gap-3',
                  !f.enabled && 'opacity-60',
                )}
              >
                <div className="flex items-center gap-2.5 min-w-36">
                  <Switch
                    checked={f.enabled}
                    onCheckedChange={(v) =>
                      setFormats((arr) =>
                        arr.map((x) => (x.format === f.format ? { ...x, enabled: v } : x)),
                      )
                    }
                    aria-label={`فعال‌سازی فرمت ${row?.label ?? f.format}`}
                  />
                  <div>
                    <div className="text-sm font-bold">{row?.label ?? f.format}</div>
                    <div className="text-[10px] text-muted-foreground">{row?.hint}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">
                    حداکثر حجم (مگابایت)
                  </Label>
                  <Input
                    value={String(f.maxMB)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, '')
                      setFormats((arr) =>
                        arr.map((x) =>
                          x.format === f.format ? { ...x, maxMB: Number(v || 0) } : x,
                        ),
                      )
                    }}
                    inputMode="numeric"
                    className="h-8 w-24 text-center text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 flex-1 min-w-64">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">
                    پسوندهای مجاز (با ویرگول)
                  </Label>
                  <Input
                    value={extText[f.format] ?? ''}
                    onChange={(e) =>
                      setExtText((t) => ({ ...t, [f.format]: e.target.value }))
                    }
                    dir="ltr"
                    className="h-8 text-xs flex-1"
                    placeholder="jpg, png, webp"
                  />
                </div>
                {!f.enabled && (
                  <Badge variant="destructive" className="text-[10px]">
                    غیرفعال
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ─── سهمیه مدارس ─── */}
      <section className="rounded-xl border bg-card p-4 space-y-4">
        <div>
          <h2 className="font-bold text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            سهمیه آپلود کل هر مدرسه (گیگابایت)
          </h2>
          <p className="text-xs text-muted-foreground mt-1 leading-5">
            مجموع حجم همه رسانه‌های آپلودشده هر مدرسه محدود می‌شود؛ عدد صفر یعنی نامحدود.
          </p>
        </div>
        {schools.length === 0 ? (
          <p className="text-xs text-muted-foreground p-4 text-center border border-dashed rounded-lg">
            هنوز مدرسه‌ای ثبت نشده است
          </p>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">مدرسه</TableHead>
                    <TableHead className="text-right">مصرف فعلی</TableHead>
                    <TableHead className="text-right">رسانه‌ها</TableHead>
                    <TableHead className="text-right w-40">سهمیه (GB) — ۰ = نامحدود</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schools.map((s) => {
                    const quota = Number(quotaText[s.id] ?? '0') || 0
                    const pct =
                      quota > 0 ? Math.min(100, Math.round((s.usageBytes / (quota * 1024 ** 3)) * 100)) : 0
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="text-xs font-bold">{s.name}</div>
                          {!s.isActive && (
                            <Badge variant="outline" className="text-[10px] mt-0.5">
                              غیرفعال
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatBytes(s.usageBytes)}
                          {quota > 0 && (
                            <div className="mt-1 h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  pct >= 100
                                    ? 'bg-destructive'
                                    : pct >= 80
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500',
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{faNum(s.fileCount)}</TableCell>
                        <TableCell>
                          <Input
                            value={quotaText[s.id] ?? '0'}
                            onChange={(e) =>
                              setQuotaText((t) => ({
                                ...t,
                                [s.id]: e.target.value.replace(/[^0-9.]/g, ''),
                              }))
                            }
                            inputMode="decimal"
                            className="h-8 text-xs"
                            aria-label={`سهمیه آپلود مدرسه ${s.name}`}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-start">
        <Button onClick={save} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
        </Button>
      </div>
    </div>
  )
}
