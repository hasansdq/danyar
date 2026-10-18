'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

/** کلید نشست «یادآوری دکمه +» — در ورود موفق پاک می‌شود تا بعد از هر ورود دوباره نمایش داده شود */
export const TEACHER_FAB_REMINDER_KEY = 'danyar:teacher-fab-reminder'

/**
 * دکمه شناور دایره‌ای «+» مخصوص نقش معلم (درخواست کاربر):
 * - فقط در صفحهٔ گفتگوها ("/") نمایان است — در بقیهٔ صفحات رندر نمی‌شود
 * - کلیک → انتقال به بخش «ثبت غیبت/نمره/تخلف» برای تاریخ امروز در تقویم آموزشی
 * - پس از هر بار ورود معلم (که به همین صفحه می‌رسد)، یک پنجره یادآوری با متن راهنما نمایش داده می‌شود
 */
export function TeacherFab() {
  const router = useRouter()
  const [reminderOpen, setReminderOpen] = useState(false)

  // یادآوری پس از ورود — فقط یک بار در هر نشست مرورگر
  // (پرچم در ورود موفق پاک می‌شود → ورود بعدی دوباره یادآوری می‌کند)
  useEffect(() => {
    let raf = 0
    try {
      if (!sessionStorage.getItem(TEACHER_FAB_REMINDER_KEY)) {
        // rAF: پرش از رندر آبشاری/هشدار set-state-in-effect + بدون چشمک هیدریشن
        raf = requestAnimationFrame(() => setReminderOpen(true))
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  const dismissReminder = () => {
    try {
      sessionStorage.setItem(TEACHER_FAB_REMINDER_KEY, '1')
    } catch {
      /* ignore */
    }
    setReminderOpen(false)
  }

  /** انتقال به «ثبت غیبت/نمره/تخلف» امروز — t یکتا تا هر کلیک دوباره فعال شود */
  const goTodayAttendance = () => {
    router.push(`/calendar?open=attendance&t=${Date.now()}`)
  }

  /** نسخهٔ هارد (بارگذاری کامل) — برای دکمهٔ داخل دیالوگ یادآوری:
   *  بستن دیالوگ (تغییر state/اَنماونت پورتال رادیکس) ترنزیشن نرمِ هم‌زمان ناوبری را
   *  در React 19 دور می‌اندازد؛ ناوبری کامل هرگز دور انداخته نمی‌شود و این مسیر فقط
   *  یک بار در هر ورود اجرا می‌شود. */
  const goTodayAttendanceHard = () => {
    window.location.assign(`/calendar?open=attendance&t=${Date.now()}`)
  }

  return (
    <>
      {/* دکمه شناور — موبایل: بالای نوار پایین؛ دسکتاپ: پایین-چپ (سایدبار سمت راست است) */}
      <button
        type="button"
        onClick={goTodayAttendance}
        data-testid="teacher-fab"
        title="ثبت غیبت/نمره/تخلف امروز"
        aria-label="ثبت غیبت، نمره یا تخلف برای امروز در تقویم آموزشی"
        className="fixed bottom-24 lg:bottom-6 left-4 z-40 flex h-14 w-14 items-center justify-center
          rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30
          transition-transform duration-150 hover:scale-105 active:scale-95
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
          motion-reduce:transition-none"
      >
        <Plus className="h-7 w-7" aria-hidden="true" />
      </button>

      {/* پنجره یادآوری پس از ورود معلم (متن عین درخواست کاربر) */}
      <Dialog
        open={reminderOpen}
        onOpenChange={(o) => {
          if (!o) dismissReminder()
        }}
      >
        <DialogContent className="sm:max-w-sm" dir="rtl" data-testid="teacher-fab-reminder">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md"
                aria-hidden="true"
              >
                <Plus className="h-5.5 w-5.5" />
              </span>
              یادآوری ثبت روزانه
            </DialogTitle>
            <DialogDescription className="pt-1 text-sm leading-7 text-foreground/90">
              از اینجا می‌تونی برای امروز نمره، غیبت و تخلف برای دانش آموزان ثبت کنی
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={dismissReminder}
              className="sm:min-w-28"
            >
              متوجه شدم
            </Button>
            <Button
              onClick={() => {
                // ناوبری هارد — بستن هم‌زمان دیالوگ، ترنزیشن نرم را دور نمی‌اندازد
                goTodayAttendanceHard()
                dismissReminder()
              }}
            >
              <Plus className="h-4 w-4" />
              ثبت برای امروز
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            دکمهٔ گرد «+» در همین صفحهٔ گفتگوها، گوشهٔ پایین صفحه در دسترس است.
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
