'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  CircleAlert,
  Loader2,
  Plus,
  Power,
  Save,
  Search,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { faDateTime, faNum } from '@/lib/format'

interface ViolationTypeRow {
  id: string
  label: string
  isActive: boolean
  sortOrder: number
  usageCount: number
  createdAt: string
  updatedAt: string
}

/**
 * مدیریت «انواع تخلف» (درخواست کاربر) — پنل مدیر کل:
 * گزینه‌های فهرست کشویی چندانتخابی ثبت تخلف (ویرایشگر جلسهٔ حضور و غیاب) از این‌جا
 * مدیریت می‌شوند: افزودن، ویرایش برچسب، فعال/غیرفعال و حذف (فقط بدون سابقهٔ ثبت‌شده).
 */
export function AdminViolationTypesClient() {
  const [loading, setLoading] = useState(true)
  const [types, setTypes] = useState<ViolationTypeRow[]>([])
  const [error, setError] = useState('')

  // فرم افزودن
  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)

  // جست‌وجو
  const [query, setQuery] = useState('')

  // ویرایش درجا
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/violation-types', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'خطا در بارگذاری انواع تخلف')
        setTypes([])
        return
      }
      setTypes(d.types ?? [])
    } catch {
      setError('اتصال برقرار نشد')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addType() {
    const label = newLabel.trim()
    if (label.length < 2) {
      toast.error('برچسب تخلف حداقل ۲ کاراکتر است')
      return
    }
    setAdding(true)
    try {
      const res = await fetch('/api/admin/violation-types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'افزودن گزینه ناموفق بود')
        return
      }
      setTypes((prev) => [...prev, d.type])
      setNewLabel('')
      toast.success('گزینهٔ تخلف اضافه شد')
    } catch {
      toast.error('اتصال برقرار نشد')
    } finally {
      setAdding(false)
    }
  }

  async function saveLabel(t: ViolationTypeRow) {
    const label = editLabel.trim()
    if (label.length < 2) {
      toast.error('برچسب تخلف حداقل ۲ کاراکتر است')
      return
    }
    setSavingId(t.id)
    try {
      const res = await fetch(`/api/admin/violation-types/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'ویرایش ناموفق بود')
        return
      }
      setTypes((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, label: d.type.label } : x)),
      )
      setEditingId(null)
      toast.success('برچسب تخلف ویرایش شد')
    } catch {
      toast.error('اتصال برقرار نشد')
    } finally {
      setSavingId(null)
    }
  }

  async function toggleActive(t: ViolationTypeRow) {
    setTogglingId(t.id)
    try {
      const res = await fetch(`/api/admin/violation-types/${t.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isActive: !t.isActive }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'تغییر وضعیت ناموفق بود')
        return
      }
      setTypes((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, isActive: d.type.isActive } : x)),
      )
      toast.success(d.type.isActive ? 'گزینه فعال شد' : 'گزینه غیرفعال شد (از فهرست انتخاب حذف می‌شود)')
    } catch {
      toast.error('اتصال برقرار نشد')
    } finally {
      setTogglingId(null)
    }
  }

  async function removeType(t: ViolationTypeRow) {
    if (
      !window.confirm(
        `گزینهٔ «${t.label}» حذف شود؟\n${t.usageCount ? `${faNum(t.usageCount)} تخلف ثبت‌شده دارد و حذف ممکن نیست.` : 'هیچ تخلفی با این برچسب ثبت نشده است.'}`,
      )
    ) {
      return
    }
    setDeletingId(t.id)
    try {
      const res = await fetch(`/api/admin/violation-types/${t.id}`, {
        method: 'DELETE',
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'حذف ناموفق بود')
        return
      }
      setTypes((prev) => prev.filter((x) => x.id !== t.id))
      toast.success('گزینه حذف شد')
    } catch {
      toast.error('اتصال برقرار نشد')
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = query.trim()
    ? types.filter((t) => t.label.includes(query.trim()))
    : types
  const activeCount = types.filter((t) => t.isActive).length

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 space-y-5" data-testid="violation-types-page">
      {/* سرصفحه */}
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <CircleAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          مدیریت انواع تخلف
        </h1>
        <p className="text-sm text-muted-foreground leading-7">
          این گزینه‌ها در فهرست کشویی چندانتخابی «ثبت تخلف» (ویرایشگر جلسهٔ حضور و غیاب معلم/مدیر)
          نمایش داده می‌شوند. تخلف‌های ثبت‌شدهٔ گذشته متن خود را حفظ می‌کنند.
        </p>
      </div>

      {/* آمار + افزودن */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{faNum(types.length)} گزینه</Badge>
          <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {faNum(activeCount)} فعال
          </Badge>
          <Badge variant="secondary" className="bg-slate-500/15 text-slate-600 dark:text-slate-400">
            {faNum(types.length - activeCount)} غیرفعال
          </Badge>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addType()
              }
            }}
            placeholder="گزینهٔ جدید (مثلاً: انجام ندادن تکلیف)"
            maxLength={120}
            data-testid="violation-type-new-input"
            aria-label="گزینهٔ تخلف جدید"
          />
          <Button
            onClick={() => void addType()}
            disabled={adding || newLabel.trim().length < 2}
            className="sm:w-40 shrink-0"
            data-testid="violation-type-add"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            افزودن گزینه
          </Button>
        </div>
      </div>

      {/* جست‌وجو */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جست‌وجو در گزینه‌ها…"
          className="pr-9"
          aria-label="جست‌وجو در گزینه‌ها"
        />
      </div>

      {/* فهرست */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          در حال بارگذاری…
        </div>
      ) : error ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>
            تلاش مجدد
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          گزینه‌ای یافت نشد — با فرم بالا گزینهٔ جدیدی اضافه کنید.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) => (
            <li
              key={t.id}
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3',
                !t.isActive && 'opacity-60',
              )}
              data-testid="violation-type-row"
            >
              {editingId === t.id ? (
                <>
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void saveLabel(t)
                      }
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    maxLength={120}
                    autoFocus
                    className="flex-1 min-w-40"
                    aria-label="ویرایش برچسب تخلف"
                    data-testid="violation-type-edit-input"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void saveLabel(t)}
                      disabled={savingId === t.id}
                      data-testid="violation-type-edit-save"
                    >
                      {savingId === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      ذخیره
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      انصراف
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-sm font-medium truncate" title={t.label}>
                    {t.label}
                  </span>
                  {t.usageCount > 0 && (
                    <Badge
                      variant="secondary"
                      className="bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] shrink-0"
                      title="تعداد تخلف ثبت‌شده با این برچسب"
                    >
                      {faNum(t.usageCount)} تخلف ثبت‌شده
                    </Badge>
                  )}
                  {!t.isActive && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      غیرفعال
                    </Badge>
                  )}
                  <span className="hidden sm:block text-[10px] text-muted-foreground shrink-0">
                    {faDateTime(t.updatedAt)}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={t.isActive}
                      onCheckedChange={() => void toggleActive(t)}
                      disabled={togglingId === t.id}
                      aria-label={`فعال/غیرفعال: ${t.label}`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingId(t.id)
                        setEditLabel(t.label)
                      }}
                      aria-label={`ویرایش ${t.label}`}
                      title="ویرایش برچسب"
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => void removeType(t)}
                      disabled={deletingId === t.id}
                      aria-label={`حذف ${t.label}`}
                      title="حذف"
                    >
                      {deletingId === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Power className="h-3.5 w-3.5 shrink-0" />
        گزینهٔ غیرفعال در فهرست انتخاب معلم/مدیر نمایش داده نمی‌شود اما سابقهٔ تخلف‌های ثبت‌شده حفظ می‌شود.
      </p>
    </div>
  )
}
