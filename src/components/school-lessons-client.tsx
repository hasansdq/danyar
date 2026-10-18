'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from '@/hooks/use-toast'
import {
  BookMarked,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ModirSectionSubNav } from '@/components/modir/section-subnav'
import { faNum } from '@/lib/format'

/**
 * مدیریت درس‌های مدرسه (درخواست کاربر — باکس «درس‌ها» در هاب مدیریت مدرسه):
 * - addOnly: فرم لیستی افزودن چند درس هم‌زمان (مثل ریاضی، علوم و…)
 * - حالت کامل: همان فرم + فهرست درس‌ها با تعداد معلمان، ویرایش نام و حذف
 */

interface LessonRow {
  id: string
  name: string
  teacherCount: number
  gradeCount: number
  createdAt: string
}

interface BulkRow {
  key: number
  name: string
}

let rowKeySeq = 1
function newRow(name = ''): BulkRow {
  return { key: rowKeySeq++, name }
}

export function SchoolLessonsClient({ addOnly = false }: { addOnly?: boolean }) {
  // ─── فرم لیستی چند درس هم‌زمان ───
  const [rows, setRows] = useState<BulkRow[]>([newRow(), newRow(), newRow()])
  const [creating, setCreating] = useState(false)
  const [createdMsg, setCreatedMsg] = useState('')

  // ─── فهرست و مدیریت ───
  const [lessons, setLessons] = useState<LessonRow[] | null>(null)
  const [listError, setListError] = useState('')
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<LessonRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [deleting, setDeleting] = useState<LessonRow | null>(null)
  const [deleteDeps, setDeleteDeps] = useState<{ teacherCount: number; gradeCount: number } | null>(null)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const loadLessons = useCallback(async () => {
    try {
      const res = await fetch('/api/lessons', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setListError(d.error ?? 'خطا در بارگذاری درس‌ها')
        setLessons([])
        return
      }
      setListError('')
      setLessons(d.lessons ?? [])
    } catch {
      setListError('اتصال برقرار نشد')
      setLessons([])
    }
  }, [])

  useEffect(() => {
    if (!addOnly) loadLessons()
  }, [addOnly, loadLessons])

  function updateRow(key: number, name: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, name } : r)))
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()])
  }

  async function submitAll(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    const names = rows.map((r) => r.name.trim()).filter(Boolean)
    if (names.length === 0) {
      toast({ title: 'حداقل یک نام درس وارد کنید', variant: 'destructive' })
      return
    }
    setCreating(true)
    setCreatedMsg('')
    try {
      const res = await fetch('/api/lessons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'افزودن درس‌ها ناموفق بود', variant: 'destructive' })
        return
      }
      const created = Number(d.createdCount ?? 0)
      const dupes: string[] = d.duplicates ?? []
      setCreatedMsg(
        `${faNum(created)} درس ایجاد شد` +
          (dupes.length ? ` — ${faNum(dupes.length)} مورد تکراری نادیده گرفته شد: ${dupes.join('، ')}` : ''),
      )
      toast({
        title: `${faNum(created)} درس ایجاد شد`,
        description: dupes.length ? `${faNum(dupes.length)} نام تکراری نادیده گرفته شد` : undefined,
      })
      setRows([newRow(), newRow(), newRow()])
      if (!addOnly) await loadLessons()
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  async function submitRename(e: FormEvent) {
    e.preventDefault()
    if (!renaming || renamingBusy) return
    const name = renameValue.trim()
    if (name.length < 2) {
      toast({ title: 'نام درس باید حداقل ۲ کاراکتر باشد', variant: 'destructive' })
      return
    }
    setRenamingBusy(true)
    try {
      const res = await fetch(`/api/lessons/${renaming.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const d = await res.json()
      if (!res.ok) {
        toast({ title: d.error ?? 'ویرایش درس ناموفق بود', variant: 'destructive' })
        return
      }
      setLessons((prev) =>
        prev ? prev.map((l) => (l.id === renaming.id ? { ...l, name: d.lesson.name } : l)) : prev,
      )
      setRenaming(null)
      toast({ title: `درس «${d.lesson.name}» به‌روز شد` })
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setRenamingBusy(false)
    }
  }

  async function requestDelete(lesson: LessonRow) {
    setDeleting(lesson)
    setDeleteDeps(null)
    try {
      // DELETE بدون confirm — اگر وابستگی باشد 409 با آمار برمی‌گرداند
      const del = await fetch(`/api/lessons/${lesson.id}`, { method: 'DELETE' })
      const d = await del.json().catch(() => ({}))
      if (del.status === 409 && d.dependencies) {
        setDeleteDeps(d.dependencies)
      } else if (del.ok) {
        // بدون وابستگی — مستقیم حذف شد
        setLessons((prev) => (prev ? prev.filter((l) => l.id !== lesson.id) : prev))
        setDeleting(null)
        toast({ title: `درس «${lesson.name}» حذف شد` })
      } else {
        toast({ title: d.error ?? 'حذف درس ناموفق بود', variant: 'destructive' })
        setDeleting(null)
      }
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
      setDeleting(null)
    }
  }

  async function confirmDelete() {
    if (!deleting || deletingBusy) return
    setDeletingBusy(true)
    try {
      const res = await fetch(`/api/lessons/${deleting.id}?confirm=true`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: d.error ?? 'حذف درس ناموفق بود', variant: 'destructive' })
        return
      }
      setLessons((prev) => (prev ? prev.filter((l) => l.id !== deleting.id) : prev))
      setDeleting(null)
      setDeleteDeps(null)
      toast({
        title: `درس «${deleting.name}» حذف شد`,
        description: 'نمرات ثبت‌شدهٔ این درس حفظ شدند (درسشان خالی می‌شود)',
      })
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    } finally {
      setDeletingBusy(false)
    }
  }

  const filtered = (lessons ?? []).filter((l) => {
    if (!query.trim()) return true
    return l.name.includes(query.trim())
  })

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold">{addOnly ? 'افزودن درس‌ها' : 'مدیریت درس‌ها'}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {addOnly
            ? 'فرم لیستی افزودن چند درس هم‌زمان — مثل ریاضی، علوم، فارسی و…'
            : 'افزودن چند درس هم‌زمان، ویرایش نام، حذف و مشاهدهٔ معلمان منتسب هر درس'}
        </p>
      </div>

      <ModirSectionSubNav
        active={addOnly ? 'add' : 'list'}
        listHref="/modir/lessons"
        addHref="/modir/lessons/add"
        listLabel="فهرست درس‌ها"
        addLabel="افزودن درس"
      />

      {/* ─── فرم لیستی افزودن چند درس هم‌زمان ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookMarked className="h-4.5 w-4.5 text-primary" />
            افزودن درس‌ها
          </CardTitle>
          <CardDescription>
            نام هر درس را در یک ردیف بنویسید؛ ردیف‌های خالی نادیده گرفته می‌شوند — همهٔ
            ردیف‌ها با دکمهٔ «ثبت کل لیست» یک‌جا ساخته می‌شوند
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitAll} className="space-y-3">
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={r.key} className="flex items-center gap-2">
                  <Label
                    htmlFor={`lesson-row-${r.key}`}
                    className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums"
                  >
                    {faNum(idx + 1)}
                  </Label>
                  <Input
                    id={`lesson-row-${r.key}`}
                    value={r.name}
                    onChange={(e) => updateRow(r.key, e.target.value)}
                    placeholder={idx === 0 ? 'مثلاً: ریاضی' : idx === 1 ? 'مثلاً: علوم' : 'نام درس…'}
                    maxLength={60}
                    data-testid={`lesson-row-input`}
                    disabled={creating}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRow(r.key)}
                    disabled={rows.length <= 1 || creating}
                    aria-label={`حذف ردیف ${faNum(idx + 1)}`}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={creating}>
                <Plus className="h-4 w-4" />
                ردیف جدید
              </Button>
              <Button type="submit" disabled={creating} data-testid="lessons-submit-all">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                ثبت کل لیست ({faNum(rows.filter((r) => r.name.trim()).length)})
              </Button>
            </div>
            {createdMsg && (
              <p className="text-xs rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 p-2.5" data-testid="lessons-created-msg">
                {createdMsg}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {/* ─── فهرست و مدیریت (فقط حالت کامل) ─── */}
      {!addOnly && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookMarked className="h-4.5 w-4.5 text-primary" />
              درس‌های مدرسه
            </CardTitle>
            <CardDescription>
              برای هر معلم از فرم ایجاد معلم (فیلد چندانتخابی درس) یا ویرایش کاربر می‌توانید
              یک یا چند درس از همین فهرست را منتسب کنید
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجوی نام درس…"
                className="pe-9"
                aria-label="جست‌وجوی درس"
              />
            </div>

            {lessons === null ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : listError ? (
              <div className="space-y-3 py-4 text-center">
                <p className="text-sm text-destructive">{listError}</p>
                <Button variant="outline" size="sm" onClick={loadLessons}>
                  تلاش مجدد
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-xl border border-dashed py-8 text-center px-3">
                {query.trim()
                  ? 'درسی با این جست‌وجو یافت نشد.'
                  : 'هنوز درسی ثبت نشده است — از فرم بالا چند درس هم‌زمان اضافه کنید.'}
              </p>
            ) : (
              <div className="rounded-xl border divide-y max-h-96 overflow-y-auto">
                {filtered.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 px-3 py-2.5"
                    data-testid="lesson-list-row"
                  >
                    <BookMarked className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-medium flex-1 min-w-0 truncate">{l.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {faNum(l.teacherCount)} معلم
                    </Badge>
                    {l.gradeCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] shrink-0 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      >
                        {faNum(l.gradeCount)} نمره
                      </Badge>
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                      onClick={() => {
                        setRenaming(l)
                        setRenameValue(l.name)
                      }}
                      aria-label={`ویرایش درس ${l.name}`}
                      title="ویرایش نام درس"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => void requestDelete(l)}
                      aria-label={`حذف درس ${l.name}`}
                      title="حذف درس"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* دیالوگ ویرایش نام درس */}
      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent dir="rtl" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ویرایش نام درس</DialogTitle>
            <DialogDescription>نام جدید درس را وارد کنید</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-3">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="نام درس"
              maxLength={60}
              autoFocus
              aria-label="نام درس"
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                انصراف
              </Button>
              <Button type="submit" disabled={renamingBusy}>
                {renamingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                ذخیره
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* دیالوگ تأیید حذف درس */}
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent dir="rtl" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>حذف درس «{deleting?.name}»</DialogTitle>
            <DialogDescription>
              {deleteDeps
                ? `این درس ${faNum(deleteDeps.teacherCount)} معلم منتسب و ${faNum(deleteDeps.gradeCount)} نمرهٔ ثبت‌شده دارد. با حذف، انتساب‌های معلمان پاک می‌شوند اما نمرات حفظ می‌شوند (درسِ نمرات خالی می‌شود).`
                : 'آیا از حذف این درس مطمئن هستید؟'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              انصراف
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deletingBusy}>
              {deletingBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف قطعی
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
