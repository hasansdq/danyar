'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Loader2, Upload, Type, ImageIcon, Sparkles, Trash2, Sun, Moon } from 'lucide-react'
import { clearBrandingCache } from '@/lib/use-branding'
import { SplashView } from '@/components/splash-view'
import { PRESET_FONTS, type PlatformSettings } from '@/lib/fonts'

/**
 * پنل ظاهر و اسپلش دانیار (مدیر کل):
 *  ۱) فونت برنامه — پیش‌فرض‌های ترند + آپلود فونت سفارشی (woff2/woff/ttf/otf)
 *  ۲) پس‌زمینه صفحات چت در حالت موبایل — جداگانه برای تم روشن/تیره
 *     (با سوییچ تم کاربر، پس‌زمینه خودکار عوض می‌شود)
 *  ۳) پخش اسپلش — مدت، متن‌ها (فونت/رنگ/اندازه/حذف)، تصویر پس‌زمینه + پیش‌نمایش زنده
 */

const FONT_OPTIONS = [...PRESET_FONTS.map((p) => ({ value: p.key, label: p.label }))]

export function AdminAppearanceClient() {
  const [s, setS] = useState<PlatformSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)
  const bgLightInputRef = useRef<HTMLInputElement>(null)
  const bgDarkInputRef = useRef<HTMLInputElement>(null)
  const splashInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/admin/branding', { cache: 'no-store' })
      if (res.ok) setS((await res.json()).settings as PlatformSettings)
    })()
  }, [])

  async function upload(type: 'font' | 'chatbg' | 'chatbgdark' | 'splash', file: File) {
    setUploading(type)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/branding/upload?type=${type}`, { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) {
        toast.error(d.error ?? 'آپلود ناموفق بود')
        return null
      }
      return d.key as string
    } finally {
      setUploading(null)
    }
  }

  async function patch(data: Partial<PlatformSettings>, msg: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const resp = await res.json()
      if (!res.ok) {
        toast.error(resp.error ?? 'ذخیره ناموفق بود')
        return false
      }
      setS(resp.settings as PlatformSettings)
      clearBrandingCache()
      toast.success(msg)
      return true
    } finally {
      setSaving(false)
    }
  }

  if (!s) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const asset = (key: string | null) => (key ? `/api/branding/asset/${key.split('/')[1]}` : null)

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          ظاهر و اسپلش
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          فونت برنامه، پس‌زمینه چت موبایل و پخش اسپلش — همه برای کل پلتفرم اعمال می‌شود.
        </p>
      </div>

      {/* ─── ۱) فونت برنامه ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Type className="h-4 w-4 text-primary" />
            فونت برنامه
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PRESET_FONTS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => void patch({ fontPreset: p.key, fontCustomKey: null }, `فونت «${p.label}» فعال شد`)}
                className={`rounded-lg border p-3 text-start transition-colors ${
                  s.fontPreset === p.key && !s.fontCustomKey
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'hover:bg-accent'
                }`}
              >
                <div className="font-bold text-base" style={{ fontFamily: `"${p.family}", Tahoma` }}>
                  دانیار آ ب پ
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">{p.label}</div>
              </button>
            ))}
          </div>

          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-medium">
                فونت سفارشی (woff2/woff/ttf/otf — حداکثر ۱۰MB)
                {s.fontCustomKey && (
                  <span className="ms-2 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-bold">
                    فعال
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  ref={fontInputRef}
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const key = await upload('font', f)
                    if (key) await patch({ fontCustomKey: key }, 'فونت سفارشی فعال شد')
                    if (fontInputRef.current) fontInputRef.current.value = ''
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading === 'font'}
                  onClick={() => fontInputRef.current?.click()}
                >
                  {uploading === 'font' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  آپلود فونت جدید
                </Button>
                {s.fontCustomKey && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void patch({ fontCustomKey: null }, 'فونت سفارشی حذف شد')}
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              فونت سفارشی با نام «DaniarCustom» روی همه دستگاه‌ها با فرمت مناسب سرو می‌شود و مقدم بر فونت‌های پیش‌فرض است.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ─── ۲) پس‌زمینه چت موبایل (جداگانه برای روشن/تیره) ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-primary" />
            پس‌زمینه صفحات چت (حالت موبایل)
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            پس‌زمینه حالت روشن و تیره جداگانه انتخاب می‌شود؛ با سوییچ تم کاربر، پس‌زمینه چت هم
            خودکار به تصویر همان حالت عوض می‌شود.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            {/* ─── حالت روشن ─── */}
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Sun className="h-4 w-4 text-amber-500" />
                پس‌زمینه حالت روشن
              </div>
              <div className="h-40 rounded-lg border bg-white overflow-hidden flex items-center justify-center">
                {asset(s.chatBgKey) ? (
                  <img src={asset(s.chatBgKey)!} alt="پس‌زمینه چت — حالت روشن" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] text-neutral-400 px-2 text-center">بدون تصویر — پیش‌فرض برنامه</span>
                )}
              </div>
              <input
                ref={bgLightInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const key = await upload('chatbg', f)
                  if (key) await patch({ chatBgKey: key }, 'پس‌زمینه چت (حالت روشن) فعال شد')
                  if (bgLightInputRef.current) bgLightInputRef.current.value = ''
                }}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading === 'chatbg'}
                  onClick={() => bgLightInputRef.current?.click()}
                >
                  {uploading === 'chatbg' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  آپلود تصویر روشن
                </Button>
                {s.chatBgKey && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void patch({ chatBgKey: null }, 'پس‌زمینه حالت روشن حذف شد')}
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                ابعاد موبایل (مثلاً <span dir="ltr">1080×1920</span>) — png/jpg/webp/gif
              </p>
            </div>

            {/* ─── حالت تیره ─── */}
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold">
                <Moon className="h-4 w-4 text-sky-500" />
                پس‌زمینه حالت تیره
              </div>
              <div className="h-40 rounded-lg border bg-[#101c22] overflow-hidden flex items-center justify-center">
                {asset(s.chatBgDarkKey) ? (
                  <img src={asset(s.chatBgDarkKey)!} alt="پس‌زمینه چت — حالت تیره" className="h-full w-full object-cover" />
                ) : s.chatBgKey ? (
                  <span className="text-[10px] text-neutral-400 px-3 text-center leading-5">
                    تصویر اختصاصی تیره انتخاب نشده —
                    <br />
                    همان تصویر روشن با لایه تیره استفاده می‌شود
                  </span>
                ) : (
                  <span className="text-[10px] text-neutral-400 px-2 text-center">بدون تصویر — پیش‌فرض برنامه</span>
                )}
              </div>
              <input
                ref={bgDarkInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.gif"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const key = await upload('chatbgdark', f)
                  if (key) await patch({ chatBgDarkKey: key }, 'پس‌زمینه چت (حالت تیره) فعال شد')
                  if (bgDarkInputRef.current) bgDarkInputRef.current.value = ''
                }}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading === 'chatbgdark'}
                  onClick={() => bgDarkInputRef.current?.click()}
                >
                  {uploading === 'chatbgdark' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  آپلود تصویر تیره
                </Button>
                {s.chatBgDarkKey && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void patch({ chatBgDarkKey: null }, 'پس‌زمینه حالت تیره حذف شد')}
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                در حالت تیره نمایش داده می‌شود؛ لایه نیمه‌شفاف تیره برای خوانایی پیام‌ها اضافه می‌شود.
              </p>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            فقط در حالت موبایل (<span dir="ltr">&lt;1024px</span>) اعمال می‌شود؛ لایه نیمه‌شفاف خودکار برای
            خوانایی پیام‌ها در هر دو حالت اضافه می‌شود (روشن: لایه سفید — تیره: لایه تیره).
          </p>
        </CardContent>
      </Card>

      {/* ─── ۳) اسپلش اسکرین ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            اسپلش اسکرین
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* پیش‌نمایش زنده */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">پیش‌نمایش زنده</Label>
            <SplashView
              previewMode
              appName={s.appName}
              schoolDisplayName="مدرسه هوشمند شهید بهشتی"
              splash={{
                enabled: s.splashEnabled,
                durationMs: s.splashDurationMs,
                showAppName: s.splashShowAppName,
                showDisplayName: s.splashShowDisplayName,
                bgUrl: asset(s.splashBgKey),
                appNameFont: s.splashAppNameFont,
                appNameColor: s.splashAppNameColor,
                appNameSize: s.splashAppNameSize,
                displayNameFont: s.splashDisplayNameFont,
                displayNameColor: s.splashDisplayNameColor,
                displayNameSize: s.splashDisplayNameSize,
              }}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-sm">نمایش اسپلش پیش از ورود</Label>
              <Switch
                checked={s.splashEnabled}
                onCheckedChange={(v) => void patch({ splashEnabled: v }, v ? 'اسپلش فعال شد' : 'اسپلش غیرفعال شد')}
              />
            </div>
            <div className="flex items-center justify-between gap-2 rounded-lg border p-3">
              <Label className="text-sm whitespace-nowrap">مدت نمایش (ثانیه)</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0.5}
                  max={15}
                  step={0.5}
                  defaultValue={(s.splashDurationMs / 1000).toString()}
                  className="w-20 h-9"
                  id="splash-duration"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    const el = document.getElementById('splash-duration') as HTMLInputElement | null
                    const sec = Number(el?.value ?? '2.2')
                    void patch({ splashDurationMs: Math.round(sec * 1000) }, 'مدت اسپلش ذخیره شد')
                  }}
                >
                  ذخیره
                </Button>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-sm">نمایش نام دانیار</Label>
              <Switch
                checked={s.splashShowAppName}
                onCheckedChange={(v) => void patch({ splashShowAppName: v }, 'به‌روزرسانی شد')}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-sm">نمایش نام مدرسه</Label>
              <Switch
                checked={s.splashShowDisplayName}
                onCheckedChange={(v) => void patch({ splashShowDisplayName: v }, 'به‌روزرسانی شد')}
              />
            </div>
          </div>

          {/* ظاهر متن‌ها */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* متن نام اپ */}
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="text-xs font-bold">متن «نام اپلیکیشن»</div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">فونت</Label>
                <Select value={s.splashAppNameFont || 'default'} onValueChange={(v) => void patch({ splashAppNameFont: v === 'default' ? '' : v }, 'فونت متن به‌روزرسانی شد')}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">فونت برنامه</SelectItem>
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">رنگ</Label>
                  <input
                    type="color"
                    value={s.splashAppNameColor}
                    onChange={(e) => void patch({ splashAppNameColor: e.target.value }, 'رنگ متن به‌روزرسانی شد')}
                    className="h-9 w-full rounded-md border bg-transparent cursor-pointer"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">اندازه (px)</Label>
                  <Input
                    type="number"
                    min={24}
                    max={160}
                    value={s.splashAppNameSize}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (v >= 24 && v <= 160) void patch({ splashAppNameSize: v }, 'اندازه متن به‌روزرسانی شد')
                    }}
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {/* متن نام مدرسه */}
            <div className="rounded-lg border p-3 space-y-2.5">
              <div className="text-xs font-bold">متن «نام مدرسه»</div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">فونت</Label>
                <Select value={s.splashDisplayNameFont || 'default'} onValueChange={(v) => void patch({ splashDisplayNameFont: v === 'default' ? '' : v }, 'فونت متن به‌روزرسانی شد')}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">فونت برنامه</SelectItem>
                    {FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">رنگ</Label>
                  <input
                    type="color"
                    value={s.splashDisplayNameColor}
                    onChange={(e) => void patch({ splashDisplayNameColor: e.target.value }, 'رنگ متن به‌روزرسانی شد')}
                    className="h-9 w-full rounded-md border bg-transparent cursor-pointer"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[11px] text-muted-foreground">اندازه (px)</Label>
                  <Input
                    type="number"
                    min={10}
                    max={64}
                    value={s.splashDisplayNameSize}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (v >= 10 && v <= 64) void patch({ splashDisplayNameSize: v }, 'اندازه متن به‌روزرسانی شد')
                    }}
                    className="h-9"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* تصویر پس‌زمینه اسپلش */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs font-medium">تصویر پس‌زمینه اسپلش (اختیاری)</div>
              <div className="flex gap-2">
                <input
                  ref={splashInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.gif"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    const key = await upload('splash', f)
                    if (key) await patch({ splashBgKey: key }, 'پس‌زمینه اسپلش فعال شد')
                    if (splashInputRef.current) splashInputRef.current.value = ''
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading === 'splash'}
                  onClick={() => splashInputRef.current?.click()}
                >
                  {uploading === 'splash' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  آپلود تصویر
                </Button>
                {s.splashBgKey && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void patch({ splashBgKey: null }, 'پس‌زمینه اسپلش حذف شد')}
                  >
                    <Trash2 className="h-4 w-4" />
                    حذف
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              بدون تصویر، پس‌زمینه تم برنامه (روشن/تاریک) استفاده می‌شود. روی تصویر سفارشی یک لایه نیمه‌شفاف برای خوانایی متن‌ها اضافه می‌شود.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
