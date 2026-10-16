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
import { faNum } from '@/lib/format'
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

  // پیش‌پرکردن کدملی مدیر موجود
  useEffect(() => {
    if (school?.users?.[0]) {
      setAdminNationalId(school.users[0].username)
    }
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
        title: 'حساب مدیر مدرسه ذخیره شد',
        description: 'نام کاربری: کدملی — رمز عبور: 123456',
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

  const admin = school.users[0]

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
          <p className="text-sm text-muted-foreground">جزئیات مدرسه، امکانات و حساب مدیر</p>
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

      {/* حساب مدیر مدرسه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4.5 w-4.5 text-primary" />
            حساب مدیر مدرسه
          </CardTitle>
          <CardDescription>
            {admin
              ? `حساب فعلی: ${admin.fullName} (کدملی: ${admin.username}) — با ثبت مجدد، رمز به ۱۲۳۴۵۶ بازمی‌گردد.`
              : 'برای این مدرسه حساب مدیر ایجاد کنید تا بتواند کلاس‌ها و کاربران را بسازد.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              رمز عبور مدیر به‌صورت خودکار ۱۲۳۴۵۶ تعیین می‌شود؛ پس از اولین ورود می‌تواند آن را تغییر دهد.
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
              {admin ? 'بازنشانی حساب مدیر' : 'ایجاد حساب مدیر'}
            </Button>
          </form>
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
