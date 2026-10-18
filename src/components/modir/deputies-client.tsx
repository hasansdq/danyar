'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast as sonnerToast } from 'sonner'
import {
  Loader2,
  ShieldCheck,
  UserPlus,
  UsersRound,
  BadgeCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ModirSectionSubNav } from '@/components/modir/section-subnav'
import { cn } from '@/lib/utils'
import { faNum, faDateTime } from '@/lib/format'

interface ViceItem {
  id: string
  username: string
  fullName: string
  phone: string | null
  isActive: boolean
  createdAt: string
  permissions: Record<string, boolean>
}

interface CatalogItem {
  key: string
  label: string
  hint: string
}

/**
 * پنل «معاونین و دسترسی‌ها» (درخواست کاربر):
 * - فهرست معاون‌های مدرسه + فرم افزودن معاون جدید (در صفحهٔ مجزای افزودن)
 * - برای هر معاون، سوییچ جداگانهٔ هر دسترسی — خاموش = محدود توسط مدیر مدرسه
 * (پیش‌فرض همهٔ سوییچ‌ها روشن است: معاون همهٔ دسترسی‌های مدیر را دارد)
 */
export function DeputiesClient({ addOnly = false }: { addOnly?: boolean }) {
  const [vices, setVices] = useState<ViceItem[] | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // فرم افزودن معاون — در حالت «فقط افزودن» از ابتدا باز است
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [phone, setPhone] = useState('')
  const [creating, setCreating] = useState(false)
  const [showForm, setShowForm] = useState(addOnly)

  const load = useCallback(async () => {
    if (addOnly) {
      // در حالت «فقط افزودن» فهرست لازم نیست — فقط کاتالوگ دسترسی‌ها برای توضیح فرم
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/vice-permissions', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'بارگذاری معاون‌ها ناموفق بود')
        setVices([])
        return
      }
      setVices(d.vices ?? [])
      setCatalog(d.catalog ?? [])
    } catch {
      sonnerToast.error('اتصال برقرار نشد')
    } finally {
      setLoading(false)
    }
  }, [addOnly])

  useEffect(() => {
    void load()
  }, [load])

  async function togglePermission(viceId: string, key: string, enabled: boolean) {
    const stamp = `${viceId}:${key}`
    setSavingKey(stamp)
    try {
      const res = await fetch('/api/vice-permissions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viceId, key, enabled }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'تغییر دسترسی ناموفق بود')
        await load()
        return
      }
      setVices((prev) =>
        prev?.map((v) =>
          v.id === viceId ? { ...v, permissions: { ...v.permissions, [key]: enabled } } : v,
        ) ?? null,
      )
      const label = catalog.find((c) => c.key === key)?.label ?? key
      const vice = vices?.find((v) => v.id === viceId)
      sonnerToast.success(
        enabled
          ? `دسترسی «${label}» برای ${vice?.fullName ?? 'معاون'} فعال شد`
          : `دسترسی «${label}» برای ${vice?.fullName ?? 'معاون'} محدود شد`,
      )
    } catch {
      sonnerToast.error('اتصال برقرار نشد')
    } finally {
      setSavingKey(null)
    }
  }

  async function addVice(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'SCHOOL_VICE',
          firstName,
          lastName,
          nationalId,
          phone: phone || null,
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        sonnerToast.error(d.error ?? 'ایجاد معاون ناموفق بود')
        return
      }
      sonnerToast.success(
        `معاون «${d.user.fullName}» ایجاد شد — رمز پیش‌فرض 123456 — همهٔ دسترسی‌ها فعال است`,
      )
      setFirstName('')
      setLastName('')
      setNationalId('')
      setPhone('')
      setShowForm(false)
      await load()
    } catch {
      sonnerToast.error('اتصال برقرار نشد')
    } finally {
      setCreating(false)
    }
  }

  const enabledCount = (v: ViceItem) =>
    Object.values(v.permissions).filter(Boolean).length

  return (
    <div className="mx-auto max-w-3xl px-3 py-5 sm:px-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <UsersRound className="h-5 w-5 text-primary" />
            {addOnly ? 'افزودن معاون جدید' : 'معاونین و دسترسی‌ها'}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {addOnly
              ? 'معاون جدید ایجاد کنید — نام کاربری = کدملی، رمز پیش‌فرض ۱۲۳۴۵۶'
              : 'معاون به‌طور پیش‌فرض همهٔ دسترسی‌های مدیر مدرسه را دارد — با سوییچ‌ها محدودش کنید'}
          </p>
        </div>
        {!addOnly && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/modir/deputies/add" data-testid="add-vice-link">
              <UserPlus className="h-4 w-4" />
              افزودن معاون
            </a>
          </Button>
        )}
      </div>

      {/* زیرناوبری دو صفحه‌ای معاونین (فهرست و دسترسی‌ها / افزودن) */}
      <ModirSectionSubNav
        active={addOnly ? 'add' : 'list'}
        listHref="/modir/deputies"
        addHref="/modir/deputies/add"
        listLabel="فهرست و دسترسی‌ها"
        addLabel="افزودن معاون"
      />

      {/* فرم افزودن معاون جدید */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">افزودن معاون جدید</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addVice} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="vice-first" className="text-xs font-medium">نام</label>
                  <Input
                    id="vice-first"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="مثلاً مریم"
                    required
                    minLength={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="vice-last" className="text-xs font-medium">نام خانوادگی</label>
                  <Input
                    id="vice-last"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="مثلاً رضایی"
                    required
                    minLength={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="vice-nid" className="text-xs font-medium">کدملی (نام کاربری)</label>
                  <Input
                    id="vice-nid"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    inputMode="numeric"
                    placeholder="۱۰ رقم"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="vice-phone" className="text-xs font-medium">شماره تماس (اختیاری)</label>
                  <Input
                    id="vice-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder="۰۹xxxxxxxxx"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                نام کاربری = کدملی · رمز پیش‌فرض 123456 · همهٔ دسترسی‌ها به‌صورت پیش‌فرض فعال است
              </p>
              <div className="flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  ایجاد معاون
                </Button>
                {!addOnly && (
                  <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                    انصراف
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* فهرست معاون‌ها + سوییچ‌های دسترسی — فقط در صفحهٔ اصلی */}
      {!addOnly && (
      <>
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin" /> در حال بارگذاری…
        </div>
      ) : !vices?.length ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <UsersRound className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="font-bold">هنوز معاونی ثبت نشده است</p>
            <p className="text-sm text-muted-foreground">
              با «افزودن معاون» اولین معاون مدرسه را بسازید و دسترسی‌هایش را مدیریت کنید.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {vices.map((v) => (
            <Card key={v.id} data-testid="vice-card">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{v.fullName}</CardTitle>
                  <Badge variant="outline" className="font-mono">{v.username}</Badge>
                  {v.isActive ? (
                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 gap-1">
                      <BadgeCheck className="h-3 w-3" /> فعال
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-muted-foreground">غیرفعال</Badge>
                  )}
                  <div className="flex-1" />
                  <span className="text-xs text-muted-foreground">
                    {faNum(enabledCount(v))} از {faNum(catalog.length)} دسترسی فعال · عضویت:{' '}
                    {faDateTime(v.createdAt)}
                  </span>
                </div>
                {v.phone ? (
                  <p className="text-xs text-muted-foreground">شماره: {v.phone}</p>
                ) : null}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid gap-2 sm:grid-cols-2">
                  {catalog.map((c) => {
                    const on = v.permissions[c.key] ?? true
                    const stamp = `${v.id}:${c.key}`
                    return (
                      <div
                        key={c.key}
                        className={cn(
                          'flex items-start justify-between gap-3 rounded-lg border p-2.5 transition-colors',
                          on ? 'bg-emerald-500/5' : 'bg-muted/40',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            {on ? (
                              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            ) : null}
                            {c.label}
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                            {c.hint}
                          </p>
                        </div>
                        <Switch
                          checked={on}
                          onCheckedChange={(checked) => void togglePermission(v.id, c.key, checked)}
                          disabled={savingKey === stamp}
                          aria-label={`${c.label} — ${v.fullName}`}
                          data-testid={`vice-switch-${c.key}`}
                        />
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      </>
      )}

      {!addOnly && (
        <p className="text-center text-[11px] text-muted-foreground">
          تغییرات بی‌درنگ اعمال می‌شود — محدودیت‌ها در همان لحظه روی دسترسی‌های معاون در همهٔ بخش‌ها
          (صفحات و APIها) اعمال می‌شوند.
        </p>
      )}
    </div>
  )
}
