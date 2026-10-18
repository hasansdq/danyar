'use client'

import { useCallback, useEffect, useState, FormEvent } from 'react'
import Link from 'next/link'
import {
  Plus,
  Loader2,
  School as SchoolIcon,
  ChevronLeft,
  Users,
  Layers,
  Pencil,
  Trash2,
  Search,
  BookOpen,
  MessagesSquare,
  BarChart3,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { apiFetch } from '@/lib/client-api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from '@/hooks/use-toast'
import { faNum, faDate, roleLabel } from '@/lib/format'

interface School {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  _count: { classrooms: number; users: number }
}

interface AdminCandidate {
  id: string
  username: string
  fullName: string
  role: string
  isActive: boolean
  school?: { id: string; name: string; isActive: boolean } | null
}

interface Stats {
  totalSchools: number
  activeSchools: number
  classrooms: number
  groups: number
  totalUsers: number
  admins: number
  teachers: number
  students: number
  messages: number
}

const PAGE_SIZE = 10

export function AdminDashboard() {
  const [schools, setSchools] = useState<School[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  // انتخاب مدیر مدرسه از بین کاربران موجود (الزام: مدیر باید کاربر انتخابی باشد)
  const [adminQuery, setAdminQuery] = useState('')
  const [adminResults, setAdminResults] = useState<AdminCandidate[] | null>(null)
  const [adminPick, setAdminPick] = useState<AdminCandidate | null>(null)
  const [adminSearching, setAdminSearching] = useState(false)
  const [adminListOpen, setAdminListOpen] = useState(false)

  // ویرایش مدرسه
  const [editSchool, setEditSchool] = useState<School | null>(null)
  const [editName, setEditName] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // حذف مدرسه
  const [deleteTarget, setDeleteTarget] = useState<{
    school: School
    deps: { users: number; classrooms: number; groups: number; messages: number }
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    // apiFetch: 401 (نشست باطل/زامبی) → هداشت خودکار به ورود
    const res = await apiFetch(`/api/schools?page=${page}&pageSize=${PAGE_SIZE}&q=${encodeURIComponent(search)}`)
    if (res.ok) {
      const data = await res.json()
      setSchools(data.schools)
      setTotal(data.total)
    } else {
      // نادیده‌گرفتن بی‌صدا = «لودینگ بی‌پایان» — پیام خطا نمایش داده می‌شود
      const d = await res.json().catch(() => null)
      setLoadError(d?.error ?? 'بارگذاری مدارس ناموفق بود')
      setSchools([])
    }
  }, [page, search])

  const loadStats = useCallback(async () => {
    const res = await apiFetch('/api/admin/stats')
    if (res.ok) setStats((await res.json()).stats)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  // تأخیر جست‌وجو
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query)
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  // جست‌وجوی کاربر برای انتخاب مدیر مدرسه جدید
  useEffect(() => {
    if (!adminListOpen) return
    const t = setTimeout(async () => {
      setAdminSearching(true)
      try {
        const res = await fetch(`/api/admin/users?q=${encodeURIComponent(adminQuery)}&pageSize=8`)
        if (res.ok) {
          const d = await res.json()
          setAdminResults((d.users ?? []) as AdminCandidate[])
        }
      } finally {
        setAdminSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [adminQuery, adminListOpen])

  async function createSchool(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    if (!adminPick) {
      toast({ title: 'مدیر مدرسه را از بین کاربران انتخاب کنید', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/schools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, adminUserId: adminPick.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد مدرسه ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `مدرسه «${data.school.name}» ایجاد شد — مدیر: ${adminPick.fullName}` })
      setName('')
      setAdminPick(null)
      setAdminQuery('')
      setPage(1)
      await Promise.all([load(), loadStats()])
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(school: School) {
    const res = await fetch(`/api/schools/${school.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !school.isActive }),
    })
    if (res.ok) {
      await Promise.all([load(), loadStats()])
      toast({ title: school.isActive ? `مدرسه «${school.name}» غیرفعال شد` : `مدرسه «${school.name}» فعال شد` })
    } else {
      const data = await res.json()
      toast({ title: data.error ?? 'تغییر وضعیت ناموفق بود', variant: 'destructive' })
    }
  }

  function openEdit(s: School) {
    setEditSchool(s)
    setEditName(s.name)
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    if (!editSchool || savingEdit) return
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/schools/${editSchool.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'نام مدرسه به‌روزرسانی شد' })
      setEditSchool(null)
      await Promise.all([load(), loadStats()])
    } finally {
      setSavingEdit(false)
    }
  }

  /** مرحله اول حذف: گرفتن آمار وابستگی‌ها از سرور */
  async function requestDelete(school: School) {
    const res = await fetch(`/api/schools/${school.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.status === 409 && data.dependencies) {
      setDeleteTarget({ school, deps: data.dependencies })
      return
    }
    if (!res.ok) {
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    await Promise.all([load(), loadStats()])
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/schools/${deleteTarget.school.id}?confirm=true`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `مدرسه «${deleteTarget.school.name}» و همه داده‌های آن حذف شد` })
      setDeleteTarget(null)
      await Promise.all([load(), loadStats()])
    } finally {
      setDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="max-w-4xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          مدیریت مدارس
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          آمار کلی پلتفرم، ایجاد و مدیریت مدارس و امکانات هر مدرسه
        </p>
      </div>

      {/* آمار کلی */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<SchoolIcon className="h-4.5 w-4.5" />} label="مدارس" value={stats?.totalSchools} sub={stats ? `${faNum(stats.activeSchools)} فعال` : undefined} />
        <StatCard icon={<Layers className="h-4.5 w-4.5" />} label="کلاس‌ها" value={stats?.classrooms} sub={stats ? `${faNum(stats.groups)} گروه درسی` : undefined} />
        <StatCard icon={<Users className="h-4.5 w-4.5" />} label="کاربران" value={stats?.totalUsers} sub={stats ? `${faNum(stats.teachers)} معلم • ${faNum(stats.students)} دانش‌آموز` : undefined} />
        <StatCard icon={<MessagesSquare className="h-4.5 w-4.5" />} label="پیام‌ها" value={stats?.messages} sub={stats ? `${faNum(stats.admins)} مدیر مدرسه` : undefined} />
      </div>

      {/* ایجاد مدرسه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4.5 w-4.5 text-primary" />
            ایجاد مدرسه جدید
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createSchool} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="نام مدرسه — مثلاً: شهید بهشتی"
                  required
                  minLength={2}
                />
                {name.trim().length >= 2 && (
                  <p className="text-[11px] text-muted-foreground">
                    نام نمایشی: <span className="font-bold text-foreground">{name.trim().startsWith('مدرسه') ? name.trim() : `مدرسه هوشمند ${name.trim()}`}</span>
                  </p>
                )}
              </div>
            </div>

            {/* انتخاب مدیر مدرسه از بین کاربران موجود */}
            <div className="relative">
              <div className="text-xs font-medium mb-1">مدیر مدرسه (از بین کاربران موجود)</div>
              {adminPick ? (
                <div className="flex items-center gap-2 rounded-lg border bg-primary/5 p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold truncate">{adminPick.fullName}</div>
                    <div className="text-[11px] text-muted-foreground" dir="ltr">
                      {adminPick.username} — {roleLabel(adminPick.role)}
                    </div>
                  </div>
                  {adminPick.school?.id && (
                    <span className="rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px] font-bold">
                      عضو مدرسه دیگر — منتقل می‌شود
                    </span>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="تغییر انتخاب"
                    onClick={() => {
                      setAdminPick(null)
                      setAdminListOpen(true)
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={adminQuery}
                      onChange={(e) => {
                        setAdminQuery(e.target.value)
                        setAdminListOpen(true)
                      }}
                      onFocus={() => setAdminListOpen(true)}
                      placeholder="جست‌وجوی نام یا نام کاربری…"
                      className="ps-9"
                      aria-label="جست‌وجوی کاربر برای مدیر مدرسه"
                    />
                  </div>
                  {adminListOpen && (
                    <div className="absolute z-20 mt-1 w-full rounded-lg border bg-card shadow-lg max-h-60 overflow-y-auto">
                      {adminSearching && (
                        <div className="flex justify-center py-3">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                      {!adminSearching && (adminResults ?? []).length === 0 && (
                        <div className="py-3 text-center text-xs text-muted-foreground">کاربری یافت نشد</div>
                      )}
                      {!adminSearching &&
                        (adminResults ?? []).map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className="w-full text-start px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2"
                            onClick={() => {
                              setAdminPick(u)
                              setAdminListOpen(false)
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate">{u.fullName}</div>
                              <div className="text-[11px] text-muted-foreground" dir="ltr">
                                {u.username} — {roleLabel(u.role)}
                              </div>
                            </div>
                            {u.school?.id && (
                              <span className="rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px]">
                                مدرسه دیگر
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <Button type="submit" disabled={creating || name.trim().length < 2 || !adminPick} className="gap-1.5">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              ایجاد مدرسه با مدیر انتخابی
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* لیست مدارس */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">مدارس پلتفرم</CardTitle>
          <CardDescription>{faNum(total)} مدرسه ثبت شده است</CardDescription>
          <div className="relative mt-2">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جست‌وجوی نام مدرسه…"
              className="ps-9"
              aria-label="جست‌وجوی مدرسه"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                <Loader2 className="h-4 w-4 me-1" />
                تلاش مجدد
              </Button>
            </div>
          ) : schools === null ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : schools.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? 'مدرسه‌ای با این نام یافت نشد.' : 'هنوز مدرسه‌ای ایجاد نشده است. اولین مدرسه را از فرم بالا بسازید.'}
            </p>
          ) : (
            <div className="divide-y">
              {schools.map((s) => (
                <div key={s.id} className="py-3 flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <SchoolIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/admin/schools/${s.id}`}
                      className="font-medium text-sm hover:text-primary transition-colors"
                    >
                      {s.name}
                    </Link>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <Layers className="h-3 w-3" />
                        {faNum(s._count.classrooms)} کلاس
                      </Badge>
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <Users className="h-3 w-3" />
                        {faNum(s._count.users)} کاربر
                      </Badge>
                      <span className="text-[11px] text-muted-foreground self-center">
                        {faDate(s.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={() => toggleActive(s)}
                      aria-label={`فعال/غیرفعال ${s.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(s)}
                      aria-label={`ویرایش ${s.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`حذف ${s.name}`}
                          onClick={() => requestDelete(s)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف مدرسه «{s.name}»؟</AlertDialogTitle>
                          <AlertDialogDescription asChild>
                            <div className="space-y-2 text-sm">
                              <p>
                                با حذف مدرسه، همه داده‌های آن برای همیشه پاک می‌شود و قابل بازگشت
                                نیست:
                              </p>
                              <ul className="list-disc ps-5 space-y-1 text-[13px]">
                                <li>{faNum(s._count.users)} حساب کاربری (مدیر، معلم، دانش‌آموز)</li>
                                <li>{faNum(s._count.classrooms)} کلاس و همه گروه‌های درسی</li>
                                <li>همه پیام‌های گروهی و خصوصی</li>
                              </ul>
                            </div>
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>انصراف</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => requestDelete(s)}
                            className="bg-destructive text-white hover:bg-destructive/90"
                          >
                            بررسی و حذف
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <Button asChild variant="ghost" size="icon" aria-label="جزئیات مدرسه">
                      <Link href={`/admin/schools/${s.id}`}>
                        <ChevronLeft className="h-4.5 w-4.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* صفحه‌بندی */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                قبلی
              </Button>
              <span className="text-xs text-muted-foreground">
                صفحه {faNum(page)} از {faNum(totalPages)} • {faNum(total)} مدرسه
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ ویرایش نام مدرسه */}
      <Dialog open={editSchool !== null} onOpenChange={(open) => !open && setEditSchool(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4.5 w-4.5 text-primary" />
              ویرایش مدرسه
            </DialogTitle>
            <DialogDescription>نام مدرسه را تغییر دهید.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-3">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} required minLength={2} />
            <Button type="submit" size="sm" disabled={savingEdit || editName.trim() === editSchool?.name} className="gap-1.5">
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              ذخیره تغییرات
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* دیالوگ حذف قطعی با آمار وابستگی‌ها */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4.5 w-4.5" />
              حذف قطعی «{deleteTarget?.school.name}»
            </DialogTitle>
            <DialogDescription>
              این عملیات غیرقابل بازگشت است. داده‌های زیر حذف خواهند شد:
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <DepRow icon={<Users className="h-4 w-4" />} label="حساب کاربری" value={deleteTarget.deps.users} />
              <DepRow icon={<Layers className="h-4 w-4" />} label="کلاس" value={deleteTarget.deps.classrooms} />
              <DepRow icon={<BookOpen className="h-4 w-4" />} label="گروه درسی" value={deleteTarget.deps.groups} />
              <DepRow icon={<MessagesSquare className="h-4 w-4" />} label="پیام گروهی" value={deleteTarget.deps.messages} />
            </div>
          )}
          <div className="flex gap-2 justify-start pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              انصراف
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting} className="gap-1.5">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              حذف قطعی مدرسه
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value?: number
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            {icon}
          </span>
          {label}
        </div>
        <div className="mt-2 text-2xl font-bold">
          {value === undefined ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : faNum(value)}
        </div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function DepRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border p-2.5 flex items-center gap-2">
      <span className="text-destructive">{icon}</span>
      <div className="min-w-0">
        <div className="font-bold">{faNum(value)}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}
