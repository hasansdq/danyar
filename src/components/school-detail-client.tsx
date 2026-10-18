'use client'

import { useCallback, useEffect, useState, FormEvent } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowRight,
  Loader2,
  UserCog,
  KeyRound,
  Layers,
  GraduationCap,
  Users,
  CheckCircle2,
  Settings2,
  Trash2,
  Search,
  Pencil,
  UserRoundCheck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { toast } from '@/hooks/use-toast'
import { faNum, roleLabel } from '@/lib/format'
import { type SchoolFeatures, FEATURE_LABELS } from '@/lib/features'

interface SchoolDetail {
  id: string
  name: string
  isActive: boolean
  _count: { classrooms: number; users: number }
  classrooms: {
    id: string
    name: string
    capacity: number | null
    _count: { subjectGroups: number; enrollments: number }
  }[]
  users: { id: string; username: string; fullName: string; isActive: boolean }[]
}

interface AdminCandidate {
  id: string
  username: string
  fullName: string
  role: string
  isActive: boolean
  school?: { id: string; name: string; isActive: boolean } | null
}

export function SchoolDetailClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const schoolId = params.id

  const [school, setSchool] = useState<SchoolDetail | null>(null)
  const [features, setFeatures] = useState<SchoolFeatures | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [adminFirstName, setAdminFirstName] = useState('')
  const [adminLastName, setAdminLastName] = useState('')
  const [adminNationalId, setAdminNationalId] = useState('')
  const [savingAdmin, setSavingAdmin] = useState(false)

  // تغییر مدیر مدرسه — انتخاب از بین کاربران موجود (درخواست کاربر)
  const [adminMode, setAdminMode] = useState<'pick' | 'create'>('pick')
  const [adminQuery, setAdminQuery] = useState('')
  const [adminResults, setAdminResults] = useState<AdminCandidate[] | null>(null)
  const [adminPick, setAdminPick] = useState<AdminCandidate | null>(null)
  const [adminSearching, setAdminSearching] = useState(false)
  const [adminListOpen, setAdminListOpen] = useState(false)
  const [transferring, setTransferring] = useState(false)

  // حذف مدرسه
  const [deleteDialog, setDeleteDialog] = useState<{
    deps: { users: number; classrooms: number; groups: number; messages: number }
  } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ظرفیت کلاس آنلاین — ویرایش درون‌ردیفی از پنل مدیر کل
  const [capEditId, setCapEditId] = useState<string | null>(null)
  const [capValue, setCapValue] = useState('')
  const [savingCap, setSavingCap] = useState(false)

  function startCapEdit(c: { id: string; capacity: number | null }) {
    setCapEditId(c.id)
    setCapValue(c.capacity ? String(c.capacity) : '')
  }

  async function saveCapacity(classroomId: string) {
    if (savingCap) return
    setSavingCap(true)
    try {
      const res = await fetch('/api/admin/classrooms', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId, capacity: capValue.trim() === '' ? null : Number(capValue) }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره ظرفیت ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: 'ظرفیت کلاس ذخیره شد',
        description: data.capacity
          ? `سقف این کلاس: ${faNum(String(data.capacity))} نفر`
          : 'سقف سراسری (پیش‌فرض) اعمال می‌شود',
      })
      setCapEditId(null)
      await load()
    } finally {
      setSavingCap(false)
    }
  }

  const load = useCallback(async () => {
    const res = await fetch(`/api/schools/${schoolId}`)
    if (res.status === 404) {
      setNotFound(true)
      return
    }
    if (res.ok) {
      const data = await res.json()
      setSchool(data.school)
      setFeatures(data.features)
      setName(data.school.name)
    }
  }, [schoolId])

  useEffect(() => {
    load()
  }, [load])

  // جست‌وجوی کاربر برای انتخاب مدیر جدید مدرسه (درخواست کاربر — امکان تغییر مدیر)
  useEffect(() => {
    if (adminMode !== 'pick' || !adminListOpen) return
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
  }, [adminQuery, adminListOpen, adminMode])

  // پیش‌پرکردن کدملی مدیر موجود
  useEffect(() => {
    const active = school?.users?.find((u) => u.isActive)
    if (active) setAdminNationalId(active.username)
  }, [school])

  async function saveName(e: FormEvent) {
    e.preventDefault()
    if (savingName) return
    setSavingName(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'نام مدرسه به‌روزرسانی شد' })
      await load()
    } finally {
      setSavingName(false)
    }
  }

  async function toggleActive() {
    if (!school) return
    const res = await fetch(`/api/schools/${schoolId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !school.isActive }),
    })
    if (res.ok) {
      await load()
      toast({ title: school.isActive ? 'مدرسه غیرفعال شد' : 'مدرسه فعال شد' })
    }
  }

  async function saveFeatures(next: SchoolFeatures) {
    setSavingFeatures(true)
    setFeatures(next)
    try {
      const res = await fetch(`/api/schools/${schoolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: next }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره امکانات ناموفق بود', variant: 'destructive' })
        await load()
        return
      }
      toast({ title: 'امکانات مدرسه به‌روزرسانی شد' })
    } finally {
      setSavingFeatures(false)
    }
  }

  /** تغییر مدیر مدرسه — انتقال مدیریت به کاربر موجود (درخواست کاربر) */
  async function changeAdmin() {
    if (transferring) return
    if (!adminPick) {
      toast({ title: 'کاربر جدید را از فهرست انتخاب کنید', variant: 'destructive' })
      return
    }
    setTransferring(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUserId: adminPick.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'تغییر مدیر ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title: data.changed
          ? `مدیریت مدرسه به «${data.admin.fullName}» منتقل شد`
          : `«${data.admin.fullName}» مدیر این مدرسه است`,
        description: data.changed
          ? `مدیر قبلی (${(data.previousAdmins ?? []).join('، ')}) غیرفعال شد — از «کاربران پلتفرم» قابل فعال‌سازی مجدد است`
          : undefined,
      })
      setAdminPick(null)
      setAdminQuery('')
      await load()
    } finally {
      setTransferring(false)
    }
  }

  async function saveAdmin(e: FormEvent) {
    e.preventDefault()
    if (savingAdmin) return
    setSavingAdmin(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}/admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: adminFirstName.trim(),
          lastName: adminLastName.trim(),
          nationalId: adminNationalId.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ذخیره حساب مدیر ناموفق بود', variant: 'destructive' })
        return
      }
      toast({
        title:
          data.mode === 'reset'
            ? 'حساب مدیر مدرسه بازنشانی شد'
            : data.changed
              ? 'مدیر جدید ساخته و مدیریت منتقل شد'
              : 'حساب مدیر مدرسه ذخیره شد',
        description: data.changed
          ? `مدیر قبلی (${(data.previousAdmins ?? []).join('، ')}) غیرفعال شد — نام کاربری جدید: کدملی — رمز: 123456`
          : 'نام کاربری: کدملی — رمز عبور: 123456',
      })
      await load()
    } finally {
      setSavingAdmin(false)
    }
  }

  /** مرحله اول حذف: گرفتن آمار وابستگی‌ها */
  async function requestDelete() {
    const res = await fetch(`/api/schools/${schoolId}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.status === 409 && data.dependencies) {
      setDeleteDialog({ deps: data.dependencies })
      return
    }
    if (!res.ok) {
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: 'مدرسه حذف شد' })
    router.push('/admin')
  }

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/schools/${schoolId}?confirm=true`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: 'مدرسه و همه داده‌های آن حذف شد' })
      router.push('/admin')
    } finally {
      setDeleting(false)
    }
  }

  if (notFound) {
    return (
      <div className="max-w-xl mx-auto px-4 py-20 text-center space-y-4">
        <p className="text-sm text-muted-foreground">مدرسه یافت نشد.</p>
        <Button variant="outline" onClick={() => router.push('/admin')}>
          <ArrowRight className="h-4 w-4" />
          بازگشت
        </Button>
      </div>
    )
  }

  if (!school || !features) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // مدیر فعال مدرسه (در صورت چند مدیر، اولین حساب فعال)
  const activeAdmin = school.users.find((u) => u.isActive)

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" aria-label="بازگشت">
          <Link href="/admin">
            <ArrowRight className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold truncate">{school.name}</h1>
          <p className="text-sm text-muted-foreground">جزئیات مدرسه، امکانات و مدیریت مدیر</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={requestDelete}>
          <Trash2 className="h-4 w-4" />
          حذف مدرسه
        </Button>
      </div>

      {/* وضعیت و آمار */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Switch checked={school.isActive} onCheckedChange={toggleActive} id="school-active" />
            <Label htmlFor="school-active" className="cursor-pointer">
              {school.isActive ? 'مدرسه فعال است' : 'مدرسه غیرفعال است'}
            </Label>
          </div>
          <Separator orientation="vertical" className="hidden sm:block h-6" />
          <Badge variant="secondary" className="gap-1">
            <Layers className="h-3 w-3" /> {faNum(school._count.classrooms)} کلاس
          </Badge>
          <Badge variant="secondary" className="gap-1">
            <Users className="h-3 w-3" /> {faNum(school._count.users)} کاربر
          </Badge>
        </CardContent>
      </Card>

      {/* امکانات مدرسه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4.5 w-4.5 text-primary" />
            امکانات قابل استفاده
          </CardTitle>
          <CardDescription>
            هر امکان فقط برای این مدرسه فعال یا غیرفعال می‌شود؛ بلافاصله برای همه کاربران آن اعمال می‌گردد.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {FEATURE_LABELS.map((f) => (
            <div key={f.key} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {f.label}
                  {f.upcoming && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      به‌زودی
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{f.description}</div>
              </div>
              <Switch
                checked={features[f.key]}
                disabled={savingFeatures || f.upcoming}
                onCheckedChange={(checked) => saveFeatures({ ...features, [f.key]: checked })}
                aria-label={`فعال/غیرفعال ${f.label}`}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* نام مدرسه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ویرایش نام مدرسه</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveName} className="flex flex-col sm:flex-row gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="flex-1"
            />
            <Button type="submit" size="sm" disabled={savingName || name.trim() === school.name} className="gap-1.5">
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              ذخیره نام
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* مدیر مدرسه — مشاهده، تغییر (انتخاب از کاربران) یا ساخت حساب جدید (درخواست کاربر) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4.5 w-4.5 text-primary" />
            مدیر مدرسه
          </CardTitle>
          <CardDescription>
            {activeAdmin
              ? `مدیر فعلی: ${activeAdmin.fullName} (کدملی: ${activeAdmin.username})`
              : 'برای این مدرسه مدیر فعالی وجود ندارد؛ از بخش زیر مدیر تعیین کنید.'}
          </CardDescription>
          {/* همهٔ حساب‌های مدیر این مدرسه (فعال/غیرفعال) */}
          {school.users.length > 0 && (
            <div className="mt-1 space-y-1">
              {school.users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border px-2.5 py-1.5"
                >
                  <UserRoundCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="font-medium text-foreground truncate">{u.fullName}</span>
                  <span dir="ltr" className="truncate">{u.username}</span>
                  {u.isActive ? (
                    <Badge className="text-[10px] ms-auto shrink-0">فعال</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] ms-auto shrink-0">
                      غیرفعال
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
          <div
            className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 mt-2"
            role="tablist"
            aria-label="بخش‌های مدیریت مدیر مدرسه"
          >
            <button
              type="button"
              role="tab"
              aria-selected={adminMode === 'pick'}
              onClick={() => setAdminMode('pick')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                adminMode === 'pick'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <UserRoundCheck className="h-4 w-4" />
              تغییر مدیر
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={adminMode === 'create'}
              onClick={() => setAdminMode('create')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                adminMode === 'create'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <KeyRound className="h-4 w-4" />
              حساب جدید / بازنشانی
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {adminMode === 'pick' ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                کاربر جدید را از بین کاربران پلتفرم انتخاب کنید تا مدیریت این مدرسه به او منتقل
                شود؛ مدیر قبلی غیرفعال می‌شود (حسابش حذف نمی‌شود و از «کاربران پلتفرم» قابل
                فعال‌سازی مجدد است).
              </p>
              <div className="relative">
                {adminPick ? (
                  <div className="flex items-center gap-2 rounded-lg border bg-primary/5 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold truncate">{adminPick.fullName}</div>
                      <div className="text-[11px] text-muted-foreground" dir="ltr">
                        {adminPick.username} — {roleLabel(adminPick.role)}
                      </div>
                    </div>
                    {adminPick.school?.id && adminPick.school.id !== schoolId && (
                      <span className="rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px] font-bold shrink-0">
                        عضو مدرسه دیگر — منتقل می‌شود
                      </span>
                    )}
                    {adminPick.role === 'SCHOOL_ADMIN' && !adminPick.school?.id && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold shrink-0">
                        مدیر بدون مدرسه
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
                        placeholder="جست‌وجوی نام یا نام کاربری کاربر…"
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
                          <div className="py-3 text-center text-xs text-muted-foreground">
                            کاربری یافت نشد
                          </div>
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
                              {u.school?.id && u.school.id !== schoolId && (
                                <span className="rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[10px] shrink-0">
                                  مدرسه دیگر
                                </span>
                              )}
                              {!u.isActive && (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] shrink-0">
                                  غیرفعال
                                </span>
                              )}
                            </button>
                          ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={transferring || !adminPick}
                onClick={changeAdmin}
              >
                {transferring ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserRoundCheck className="h-4 w-4" />
                )}
                انتقال مدیریت به کاربر انتخابی
              </Button>
            </div>
          ) : (
            <form onSubmit={saveAdmin} className="grid sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="a-first">نام</Label>
                <Input
                  id="a-first"
                  value={adminFirstName}
                  onChange={(e) => setAdminFirstName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-last">نام خانوادگی</Label>
                <Input
                  id="a-last"
                  value={adminLastName}
                  onChange={(e) => setAdminLastName(e.target.value)}
                  required
                  minLength={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-nid">کدملی (نام کاربری)</Label>
                <Input
                  id="a-nid"
                  dir="ltr"
                  className="text-left"
                  placeholder="کدملی ۱۰ رقمی"
                  inputMode="numeric"
                  value={adminNationalId}
                  onChange={(e) => setAdminNationalId(e.target.value)}
                  required
                />
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-3 flex items-center gap-1">
                <KeyRound className="h-3 w-3" />
                اگر کدملیِ مدیر فعلی را وارد کنید حساب همان شخص بازنشانی می‌شود (رمز به ۱۲۳۴۵۶
                برمی‌گردد)؛ با کدملی جدید، مدیر جدید ساخته و مدیر قبلی غیرفعال می‌شود.
              </p>
              <Button
                type="submit"
                size="sm"
                className="gap-1.5 sm:col-span-3 sm:w-fit"
                disabled={savingAdmin}
              >
                {savingAdmin ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {activeAdmin ? 'بازنشانی / ساخت حساب مدیر' : 'ایجاد حساب مدیر'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* کلاس‌ها */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-4.5 w-4.5 text-primary" />
            کلاس‌های این مدرسه
          </CardTitle>
          <CardDescription>
            ظرفیت کلاس آنلاین هر کلاس از این‌جا تعیین می‌شود؛ خالی = سقف سراسری.
            مدیریت کامل سقف‌ها (سقف جلسهٔ مدرسه و سقف جلسات هم‌زمان) در بخش
            «مدیریت کلاس‌های آنلاین» است — ظرفیت هر کلاس در محدودهٔ سقف مدرسه.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {school.classrooms.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              هنوز کلاسی ایجاد نشده است.
            </p>
          ) : (
            <div className="divide-y">
              {school.classrooms.map((c) => (
                <div key={c.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                  <span className="font-medium text-sm">{c.name}</span>
                  <div className="flex gap-2 items-center flex-wrap">
                    <Badge variant="secondary" className="text-[11px]">
                      {faNum(c._count.subjectGroups)} گروه درسی
                    </Badge>
                    <Badge variant="secondary" className="text-[11px]">
                      {faNum(c._count.enrollments)} دانش‌آموز
                    </Badge>
                    {capEditId === c.id ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={capValue}
                          onChange={(e) => setCapValue(e.target.value.replace(/[^0-9]/g, ''))}
                          placeholder="۳۲"
                          inputMode="numeric"
                          className="h-8 w-24 text-center"
                          aria-label={`ظرفیت کلاس آنلاین ${c.name}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveCapacity(c.id)
                            if (e.key === 'Escape') setCapEditId(null)
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8 px-2.5"
                          disabled={savingCap || (capValue.trim() !== '' && (Number(capValue) < 2 || Number(capValue) > 500))}
                          onClick={() => saveCapacity(c.id)}
                        >
                          {savingCap ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          ذخیره
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setCapEditId(null)}>
                          انصراف
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Badge
                          variant="outline"
                          className="text-[11px] gap-1 cursor-pointer hover:bg-accent"
                          title="تعیین ظرفیت کلاس آنلاین"
                        >
                          <Users className="h-3 w-3" />
                          {c.capacity ? `ظرفیت: ${faNum(String(c.capacity))}` : 'ظرفیت: پیش‌فرض'}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 gap-1.5 text-[12px]"
                          onClick={() => startCapEdit(c)}
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          ظرفیت
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* دیالوگ حذف قطعی مدرسه */}
      <Dialog open={deleteDialog !== null} onOpenChange={(open) => !open && setDeleteDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4.5 w-4.5" />
              حذف قطعی «{school.name}»
            </DialogTitle>
            <DialogDescription>
              این عملیات غیرقابل بازگشت است. داده‌های زیر حذف خواهند شد:
            </DialogDescription>
          </DialogHeader>
          {deleteDialog && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <DepRow label="حساب کاربری" value={deleteDialog.deps.users} />
              <DepRow label="کلاس" value={deleteDialog.deps.classrooms} />
              <DepRow label="گروه درسی" value={deleteDialog.deps.groups} />
              <DepRow label="پیام گروهی" value={deleteDialog.deps.messages} />
            </div>
          )}
          <div className="flex gap-2 justify-start pt-2">
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>
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

function DepRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="font-bold">{faNum(value)}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}
