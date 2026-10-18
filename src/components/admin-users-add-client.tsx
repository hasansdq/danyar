'use client'

import { useCallback, useEffect, useState } from 'react'
import { UserPlus, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { UsersSubNav } from '@/components/users-subnav'
import { DEFAULT_PASS_HINT } from '@/components/user-add-forms'
import {
  BulkStudentAddForm,
  SingleAddUserForm,
  ExcelImportForm,
  type SchoolOption,
} from '@/components/user-add-forms'

/**
 * صفحهٔ «افزودن کاربر» پنل مدیر کل — فرم‌های افزودن (تکی/گروهی/اکسل)
 * در صفحه‌ای جدا از فهرست کاربران (درخواست کاربر).
 */
export function AdminUsersAddClient() {
  const [schools, setSchools] = useState<SchoolOption[]>([])
  const [loaded, setLoaded] = useState(false)

  const loadFilters = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { method: 'POST' })
      if (res.ok) setSchools((await res.json()).schools ?? [])
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    loadFilters()
  }, [loadFilters])

  return (
    <div className="max-w-5xl mx-auto px-3 py-5 sm:px-4 space-y-5">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          کاربران پلتفرم
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">افزودن کاربر</span>
      </div>

      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary" />
          افزودن کاربر
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          افزودن تکی، گروهی و ایمپورت اکسل — {DEFAULT_PASS_HINT}
        </p>
      </div>

      <UsersSubNav active="add" />

      {loaded ? (
        <div className="space-y-5">
          {/* افزودن کاربر تکی */}
          <SingleAddUserForm scope="platform" schools={schools} />

          {/* افزودن گروهی دانش‌آموزان */}
          <BulkStudentAddForm scope="platform" schools={schools} />

          {/* ایمپورت اکسل */}
          <ExcelImportForm scope="platform" schools={schools} />
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            در حال بارگذاری مدارس…
          </CardContent>
        </Card>
      )}

      {/* راهنمای بازگشت */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
          <span>
            پس از ایجاد، کاربران در «فهرست کاربران» قابل مشاهده و مدیریت هستند (ویرایش، تغییر رمز،
            فعال/غیرفعال‌سازی و ورود به‌جای کاربر).
          </span>
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-1 text-primary hover:underline font-medium shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            رفتن به فهرست کاربران
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
