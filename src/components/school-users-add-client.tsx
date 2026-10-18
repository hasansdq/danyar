'use client'

/**
 * افزودن کاربر مدرسه — صفحهٔ مجزای فرم‌های ثبت‌نام (درخواست کاربر:
 * باکس‌های افزودن کاربر از لیست کاربران در دو صفحهٔ جدا باشند):
 *  ۱) افزودن گروهی دانش‌آموزان (لیست قابل گسترش + ثبت کل لیست)
 *  ۲) افزودن دانش‌آموز تکی (شماره تماس اختیاری)
 *  ۳) افزودن معلم تکی (گروه‌های درسی اختیاری)
 *  ۴) افزودن معاون مدرسه — فقط مدیر مدرسه
 *  ۵) ایمپورت اکسل
 * نام کاربری همه = کدملی؛ رمز پیش‌فرض = 123456؛ رمز ضعیف (فقط عدد/حرف) مجاز است.
 *
 * ?create=teacher|student|vice (ورود از آیکون + کارت‌های آماری مدیریت مدرسه):
 * فقط همان فرم نمایش داده می‌شود (درخواست کاربر: + → صفحه‌ای که فقط فرم افزودن
 * همان مورد باشد) — با دکمهٔ «نمایش همهٔ فرم‌ها» بقیهٔ فرم‌ها هم در دسترس است.
 */

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { UsersSubNav } from '@/components/users-subnav'
import {
  BulkStudentAddForm,
  StudentAddForm,
  TeacherAddForm,
  ViceAddForm,
  ExcelImportForm,
} from '@/components/user-add-forms'
import { type VicePerms } from '@/components/school-users-client'

type CreateFocus = 'student' | 'teacher' | 'vice' | null

const FOCUS_TITLES: Record<Exclude<CreateFocus, null>, string> = {
  student: 'افزودن دانش‌آموز جدید',
  teacher: 'افزودن معلم جدید',
  vice: 'افزودن معاون مدرسه',
}

export function SchoolUsersAddClient({ permissions = null }: { permissions?: VicePerms | null }) {
  // مدیر مدرسه همه‌چیز را می‌تواند؛ معاون بر اساس سوییچ‌های مدیر
  const isVice = permissions !== null
  const canRegisterStudents = !isVice || !!permissions?.register_students
  const canRegisterTeachers = !isVice || !!permissions?.register_teachers

  // ورود از آیکون + کارت‌های آماری با ?create=… — پارامتر در اولین رندر خوانده
  // می‌شود (بدون فلش «همهٔ فرم‌ها → یک فرم»)؛ با «نمایش همه» به‌صورت دستی باز می‌گردد
  const searchParams = useSearchParams()
  const router = useRouter()
  const createParam = searchParams.get('create')
  const urlFocus: CreateFocus =
    createParam === 'teacher' || createParam === 'student' || createParam === 'vice'
      ? createParam
      : null
  const [showAll, setShowAll] = useState(false)

  /** نمایش همهٔ فرم‌ها + پاک‌سازی پارامتر URL تا رفرش روی همان حالت بماند */
  function showAllForms() {
    setShowAll(true)
    const sp = new URLSearchParams(window.location.search)
    if (sp.has('create')) {
      sp.delete('create')
      const qs = sp.toString()
      router.replace(
        `${window.location.pathname}${qs ? `?${qs}` : ''}`,
        { scroll: false },
      )
    }
  }

  // فیلتر مجوز معاون روی focus — معاون معاون نمی‌سازد و فرم‌های محدود را نمی‌بیند
  const effectiveFocus: CreateFocus =
    showAll
      ? null
      : urlFocus === 'vice' && isVice
        ? null
        : urlFocus === 'student' && !canRegisterStudents
          ? null
          : urlFocus === 'teacher' && !canRegisterTeachers
            ? null
            : urlFocus

  return (
    <div className="max-w-4xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            {effectiveFocus ? FOCUS_TITLES[effectiveFocus] : 'افزودن کاربر مدرسه'}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {effectiveFocus
              ? 'فقط فرم افزودن همین مورد نمایش داده می‌شود — نام کاربری کدملی و رمز اولیه ۱۲۳۴۵۶ است'
              : 'ثبت‌نام تکی و گروهی معلم، دانش‌آموز و معاون — نام کاربری هر کاربر کدملی و رمز اولیه او ۱۲۳۴۵۶ است'}
          </p>
        </div>
        <UsersSubNav active="add" base="/modir/users" />
      </div>

      {effectiveFocus && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={showAllForms} className="gap-1.5">
            <LayoutGrid className="h-4 w-4" />
            نمایش همهٔ فرم‌های افزودن
          </Button>
        </div>
      )}

      {isVice && !effectiveFocus && (
        <p className="text-[11px] text-muted-foreground">
          بخش‌هایی که مدیر مدرسه برای شما محدود کرده، اینجا نمایش داده نمی‌شوند.
        </p>
      )}
      {effectiveFocus ? (
        <>
          {effectiveFocus === 'student' && canRegisterStudents && (
            <StudentAddForm scope="school" />
          )}
          {effectiveFocus === 'teacher' && canRegisterTeachers && (
            <TeacherAddForm scope="school" />
          )}
          {effectiveFocus === 'vice' && !isVice && <ViceAddForm scope="school" />}
        </>
      ) : (
        <>
          {/* ۱) افزودن گروهی دانش‌آموزان */}
          {canRegisterStudents && <BulkStudentAddForm scope="school" />}

          {/* ۲) ایجاد دانش‌آموز — شماره تماس اختیاری (درخواست کاربر) */}
          {canRegisterStudents && <StudentAddForm scope="school" />}

          {/* ۳) ایجاد معلم — گروه‌های درسی اختیاری (درخواست کاربر) */}
          {canRegisterTeachers && <TeacherAddForm scope="school" />}

          {/* ۴) ایجاد معاون مدرسه — فقط مدیر مدرسه (معاون، معاون نمی‌سازد) */}
          {!isVice && <ViceAddForm scope="school" />}

          {/* ۵) ایمپورت اکسل */}
          {(canRegisterStudents || canRegisterTeachers) && <ExcelImportForm scope="school" />}
        </>
      )}

      {/* پیوند به فهرست کاربران */}
      <div className="flex justify-center pt-1">
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <a href="/modir/users">
            <CheckCircle2 className="h-4 w-4" />
            مشاهده فهرست کاربران
          </a>
        </Button>
      </div>
    </div>
  )
}
