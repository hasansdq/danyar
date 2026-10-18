'use client'

/**
 * هم‌گام‌سازی دیالوگ‌ها با دکمهٔ برگشت موبایل (درخواست کاربر):
 * وقتی یک پنجره (Dialog/AlertDialog) باز می‌شود، یک ورودی history با
 * pushState اضافه می‌شود؛ فشردن دکمهٔ back سیستم‌عامل به‌جای خروج از صفحه،
 * همین ورودی را می‌بَرد و پنجرهٔ باز بسته می‌شود.
 * بستن پنجره با دکمهٔ X / ESC هم ورودی history را پاک می‌کند تا stack سالم بماند.
 *
 * پشتیبانی چند پنجرهٔ تو در تو: هر باز شدن یک ورودی push می‌کند و
 * popstate همیشه بالاترین (آخرین) پنجره را می‌بندد — LIFO.
 */

import { useEffect, useRef } from 'react'

type Closer = () => void

let stack: Closer[] = []
/** تعداد backهای خودمان (پاک‌سازی ورودی) — popstate این‌ها را نادیده می‌گیرد */
let internalBacks = 0
/** آخرین popstate توسط دیالوگ مصرف شد؟ (برای جلوگیری از تداخل با گاردهای ناوبری) */
let lastPopWasDialog = false

const DIALOG_STATE_KEY = '__daniarDialog'

function currentIsDialogEntry(): boolean {
  try {
    return Boolean((window.history.state as Record<string, unknown> | null)?.[DIALOG_STATE_KEY])
  } catch {
    return false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (internalBacks > 0) {
      // back صادرشدهٔ خودِ ما برای پاک‌سازی ورودی دیالوگ — نه فشردن back توسط کاربر
      internalBacks--
      lastPopWasDialog = true
      return
    }
    const closer = stack.pop()
    if (closer) {
      lastPopWasDialog = true
      closer()
    } else {
      lastPopWasDialog = false
    }
  })
}

/** آیا آخرین popstate توسط بستن دیالوگ مصرف شد؟ — گاردهای ناوبری باید نادیده بگیرند */
export function wasDialogPopstate(): boolean {
  return lastPopWasDialog
}

/** باز شدن پنجره — یک ورودی history push می‌کند و closer را ثبت می‌کند */
export function pushDialogCloser(closer: Closer) {
  try {
    window.history.pushState({ [DIALOG_STATE_KEY]: true }, '')
  } catch {
    /* محیط بدون history — بی‌خطر */
  }
  stack.push(closer)
}

/** بستن پنجره از طریق UI — ورودی history مربوطه را برمی‌دارد */
export function removeDialogCloser() {
  stack.pop()
  if (currentIsDialogEntry()) {
    internalBacks++
    try {
      window.history.back()
    } catch {
      internalBacks--
    }
  }
}

/** unmount پنجرهٔ باز (ناوبری به صفحهٔ دیگر) — فقط پاک‌سازی stack، بدون دست‌زدن به history */
export function dropDialogCloserSilently() {
  stack.pop()
}

/**
 * ناوبری بلافاصله پس از بستن یک دیالوگ — بدون مسابقه با پاک‌سازی history دیالوگ.
 *
 * الگوی «setOpen(false) + router.push» یک race سیستماتیک دارد: پاک‌سازی ورودی
 * history دیالوگ با history.back() «غیرهمگام» انجام می‌شود؛ اگر router.push
 * زودتر رخ دهد (RSC کش‌شده سریع)، back ورودیِ تازه‌pushشده را می‌بَرد و ناوبری
 * بی‌اثر می‌ماند — کاربر در همان صفحه می‌ماند (مثلاً کلیک روی گزینهٔ «گفتگوی جدید»
 * یا «شروع کلاس و ورود به اتاق» ظاهراً هیچ کاری نمی‌کرد). این تابع ناوبری را
 * تا popstate خودِ back پاک‌ساز (یا سقف ۳۵۰ms وقتی دیالوگی باز نبوده) عقب
 * می‌اندازد تا ترتیب ورودی‌های history سالم بماند.
 */
export function navigateAfterDialogClose(push: () => void): void {
  if (typeof window === 'undefined') {
    push()
    return
  }
  let done = false
  const go = () => {
    if (done) return
    done = true
    window.removeEventListener('popstate', go)
    if (fallback !== undefined) clearTimeout(fallback)
    push()
  }
  const fallback = setTimeout(go, 350)
  window.addEventListener('popstate', go)
}

/**
 * هوک اصلی — در Root دیالوگ‌ها استفاده می‌شود:
 *  open false→true: ثبت ورودی history · true→false: حذف ورودی
 *  (مگر اینکه بسته‌شدن خودِ popstate بوده باشد — آن‌وقت ورودی خودش رفته است)
 *  unmount در حالت باز: پاک‌سازی بی‌صدا
 */
export function useDialogHistory(open: boolean, setOpen: (open: boolean) => void): void {
  const hasEntryRef = useRef(false)
  const byPopRef = useRef(false)
  const setOpenRef = useRef(setOpen)

  // refها فقط داخل effect به‌روز می‌شوند (قاعدهٔ react-hooks)
  useEffect(() => {
    setOpenRef.current = setOpen
  }, [setOpen])

  useEffect(() => {
    if (open && !hasEntryRef.current) {
      hasEntryRef.current = true
      pushDialogCloser(() => {
        byPopRef.current = true
        setOpenRef.current(false)
      })
    } else if (!open && hasEntryRef.current) {
      hasEntryRef.current = false
      if (byPopRef.current) {
        // بسته‌شدن به‌دست popstate — ورودی history خودش pop شده؛ فقط پرچم پاک شود
        byPopRef.current = false
      } else {
        removeDialogCloser()
      }
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (hasEntryRef.current) {
        hasEntryRef.current = false
        dropDialogCloserSilently()
      }
    }
  }, [])
}
