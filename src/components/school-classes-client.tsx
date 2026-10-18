'use client'

import { useCallback, useEffect, useState, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Loader2,
  Layers,
  ChevronLeft,
  Trash2,
  BookOpen,
  GraduationCap,
  Search,
  ArrowRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { faNum } from '@/lib/format'
import {
  BRANCH_MAX,
  GRADE_OPTIONS,
  composeClassName,
  toPersianDigits,
} from '@/lib/school'

interface Classroom {
  id: string
  name: string
  grade?: string | null
  allowStudentDm: boolean
  _count: { subjectGroups: number; enrollments: number }
}

/**
 * مدیریت کلاس‌ها (درخواست کاربر): فرم «افزودن کلاس» و «فهرست کلاس‌ها» داخل
 * همان باکس کلاس‌ها ادغام شده‌اند — یک کارت واحد با فرم ایجاد در بالا و فهرست
 * زیر آن؛ باکس‌های آماری هشتگانه به صفحهٔ مستقل هاب (/modir) منتقل شدند و دیگر
 * زیر آن‌ها قرار نمی‌گیرند.
 *
 * حالت addOnly (صفحهٔ /modir/classes/add — مقصد آیکون + کارت کلاس‌ها):
 * فقط فرم ایجاد کلاس، بدون فهرست.
 */
export function SchoolClassesClient({
  addOnly = false,
}: {
  addOnly?: boolean
}) {
  const router = useRouter()
  const [classes, setClasses] = useState<Classroom[] | null>(null)
  // فرم دو فیلدی ایجاد کلاس: پایه (کشویی) + شعبه (متنی) → «هفتم ۷۰۳»
  const [grade, setGrade] = useState('')
  const [branch, setBranch] = useState('')
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  // محدودیت گروه‌ها: کلید گفتگوی خصوصی دانش‌آموزان — id کلاس در حال ذخیره یا 'all'
  const [dmPendingId, setDmPendingId] = useState<string | null>(null)

  const classNamePreview = grade && branch.trim() ? composeClassName(grade, branch) : ''

  const load = useCallback(async () => {
    const res = await fetch('/api/classes')
    if (res.ok) {
      const data = await res.json()
      setClasses(data.classrooms)
    }
  }, [])

  // فهرست کلاس‌ها فقط در صفحهٔ اصلی بارگذاری می‌شود (حالت «فقط افزودن» فهرست ندارد)
  useEffect(() => {
    if (!addOnly) load()
  }, [load, addOnly])

  async function createClass(e: FormEvent) {
    e.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade, branch: branch.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: data.error ?? 'ایجاد کلاس ناموفق بود', variant: 'destructive' })
        return
      }
      toast({ title: `کلاس «${data.classroom.name}» ایجاد شد` })
      setGrade('')
      setBranch('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  async function deleteClass(id: string, className: string) {
    const res = await fetch(`/api/classes/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json()
      toast({ title: data.error ?? 'حذف ناموفق بود', variant: 'destructive' })
      return
    }
    toast({ title: `کلاس «${className}» حذف شد` })
    await load()
  }

  // جست‌وجو با ارقام لاتین هم باید «هفتم ۷۰۳» را بیابد → پرس‌وجو به ارقام فارسی نرمال می‌شود
  const filteredClasses = (classes ?? []).filter((c) =>
    query.trim() ? c.name.includes(toPersianDigits(query.trim())) : true,
  )
  const canCreateClass = Boolean(grade) && Boolean(branch.trim()) && !creating

  /** تعیین پایهٔ کلاس‌های قدیمی بدون پایه — همه دانش‌آموزان کلاس پایهٔ آن را می‌گیرند */
  async function setClassGrade(classroomId: string, grade: string) {
    try {
      const res = await fetch(`/api/classes/${classroomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast({ title: data?.error ?? 'ثبت پایه ناموفق بود', variant: 'destructive' })
        return
      }
      setClasses(
        (prev) =>
          prev?.map((c) => (c.id === classroomId ? { ...c, grade } : c)) ?? null,
      )
      toast({ title: `پایه «${grade}» برای کلاس ثبت شد` })
    } catch {
      toast({ title: 'خطا در برقراری ارتباط با سرور', variant: 'destructive' })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="بازگشت به مدیریت مدرسه">
          <Link href={addOnly ? '/modir/classes' : '/modir'}>
            <ArrowRight className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{addOnly ? 'افزودن کلاس جدید' : 'کلاس‌ها'}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {addOnly
              ? 'نام کلاس با الگوی «پایه + شعبه» ساخته می‌شود — مثلاً: هفتم ۷۰۳'
              : 'ایجاد کلاس جدید و مدیریت کلاس‌های موجود مدرسه'}
          </p>
        </div>
      </div>

      {/* باکس واحد کلاس‌ها — فرم ایجاد و فهرست ادغام‌شده داخل همان باکس (درخواست کاربر) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4.5 w-4.5 text-primary" />
            {addOnly ? 'ایجاد کلاس جدید' : 'مدیریت کلاس‌ها'}
          </CardTitle>
          <CardDescription>
            نام کلاس با الگوی «پایه + شعبه» ساخته می‌شود — مثلاً: هفتم ۷۰۳
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* فرم ایجاد کلاس — الگوی دو فیلدی: پایه (کشویی) + شعبه (متنی) */}
          <form onSubmit={createClass} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="space-y-1.5 sm:w-52">
                <Label htmlFor="grade-select">انتخاب پایه</Label>
                <Select value={grade} onValueChange={setGrade} name="grade">
                  <SelectTrigger id="grade-select" className="w-full" aria-label="انتخاب پایه">
                    <SelectValue placeholder="انتخاب پایه" />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADE_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 flex-1">
                <Label htmlFor="branch-input">انتخاب نام شعبه</Label>
                <Input
                  id="branch-input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="مثلاً ۷۰۳"
                  required
                  maxLength={BRANCH_MAX}
                  className="w-full"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={!canCreateClass} className="gap-1.5 w-full sm:w-auto">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  ایجاد کلاس
                </Button>
              </div>
            </div>
            {classNamePreview && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                نام کلاس: <span className="font-semibold text-foreground">«{classNamePreview}»</span>
              </p>
            )}
          </form>

          {/* فهرست کلاس‌ها — در همان باکس، فقط در صفحهٔ اصلی (در حالت «فقط افزودن» مخفی) */}
          {!addOnly && (
            <>
              <div className="border-t pt-4" />
              <div className="relative">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جست‌وجوی نام کلاس…"
                  className="ps-9"
                  aria-label="جست‌وجوی کلاس"
                />
              </div>
              {classes === null ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredClasses.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {query ? 'کلاسی با این نام یافت نشد.' : 'هنوز کلاسی ایجاد نشده است.'}
                </p>
              ) : (
                <div className="divide-y">
                  {filteredClasses.map((c) => (
                    <div key={c.id} className="py-3 flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Layers className="h-5 w-5" />
                      </div>
                      <button
                        className="flex-1 min-w-0 text-right"
                        onClick={() => router.push(`/modir/classes/${c.id}`)}
                      >
                        <div className="font-medium text-sm">{c.name}</div>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {c.grade ? (
                            <Badge variant="secondary" className="gap-1 text-[11px] bg-sky-500/10 text-sky-700 dark:text-sky-400">
                              <GraduationCap className="h-3 w-3" />
                              پایه {c.grade}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                              <GraduationCap className="h-3 w-3" />
                              بدون پایه
                            </Badge>
                          )}
                          <Badge variant="secondary" className="gap-1 text-[11px]">
                            <BookOpen className="h-3 w-3" />
                            {faNum(c._count.subjectGroups)} گروه درسی
                          </Badge>
                          <Badge variant="secondary" className="gap-1 text-[11px]">
                            <GraduationCap className="h-3 w-3" />
                            {faNum(c._count.enrollments)} دانش‌آموز
                          </Badge>
                        </div>
                      </button>
                      {!c.grade && (
                        <Select
                          value=""
                          onValueChange={(g) => void setClassGrade(c.id, g)}
                        >
                          <SelectTrigger
                            className="w-[120px] h-8 text-[11px] shrink-0"
                            aria-label={`تعیین پایه برای کلاس ${c.name}`}
                          >
                            <SelectValue placeholder="تعیین پایه…" />
                          </SelectTrigger>
                          <SelectContent>
                            {GRADE_OPTIONS.map((g) => (
                              <SelectItem key={g} value={g}>
                                پایه {g}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`حذف کلاس ${c.name}`}>
                            <Trash2 className="h-4.5 w-4.5 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>حذف کلاس «{c.name}»؟</AlertDialogTitle>
                            <AlertDialogDescription>
                              همه گروه‌های درسی، انتساب معلمان، ثبت‌نام دانش‌آموزان و پیام‌های این کلاس
                              حذف می‌شوند و قابل بازگشت نیست.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>انصراف</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteClass(c.id, c.name)}
                              className="bg-destructive text-white hover:bg-destructive/90"
                            >
                              حذف قطعی
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Button asChild variant="ghost" size="icon" aria-label="مدیریت کلاس">
                        <Link href={`/modir/classes/${c.id}`}>
                          <ChevronLeft className="h-4.5 w-4.5" />
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
