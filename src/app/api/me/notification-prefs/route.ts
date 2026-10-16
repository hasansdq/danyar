import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, jsonError } from '@/lib/api-auth'
import { parsePushEventTypes, PUSH_EVENT_CATEGORIES } from '@/lib/push-types'

/** GET /api/me/notification-prefs — ترجیحات اعلان کاربر */
export async function GET() {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const pref = await db.notificationPref.findUnique({
    where: { userId: res.session.uid },
  })
  return NextResponse.json({
    browserEnabled: pref?.browserEnabled ?? false,
    previewEnabled: pref?.previewEnabled ?? false,
    // انواع رویداد دارای پوش؛ خالی = همه انواع فعال
    pushEventTypes: [...parsePushEventTypes(pref?.pushEventTypes)],
    // صدای هشدار پاپ‌آپ شروع کلاس (نمایش پاپ‌آپ به این تنظیم وابسته نیست)
    soundEnabled: pref?.soundEnabled ?? true,
  })
}

/** PUT /api/me/notification-prefs — ذخیره ترجیحات (پیش‌نمایش + انواع رویداد پوش) */
export async function PUT(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session

  const body = await req.json().catch(() => null)
  if (!body) return jsonError('درخواست نامعتبر است')

  const previewEnabled = !!body.previewEnabled
  const browserEnabled = !!body.browserEnabled // سازگاری با کلاینت قدیمی — اثر عملی ندارد
  // صدای هشدار پاپ‌آپ شروع کلاس — پیش‌فرض روشن
  const soundEnabled = 'soundEnabled' in body ? !!body.soundEnabled : undefined

  // انواع رویداد پوش: فقط مقادیر معتبر؛ خالی/حذف‌شده = همه انواع
  let pushEventTypes: string | undefined
  if ('pushEventTypes' in body) {
    if (!Array.isArray(body.pushEventTypes)) return jsonError('انواع رویداد نامعتبر است')
    const valid = body.pushEventTypes.filter(
      (v: unknown): v is string => typeof v === 'string' && (PUSH_EVENT_CATEGORIES as readonly string[]).includes(v),
    )
    const unique = [...new Set(valid)]
    // انتخاب همه انواع = مقدار خالی (پیش‌فرض)
    pushEventTypes = JSON.stringify(
      unique.length === PUSH_EVENT_CATEGORIES.length ? [] : unique,
    )
  }

  const saved = await db.notificationPref.upsert({
    where: { userId: session.uid },
    create: {
      userId: session.uid,
      browserEnabled,
      previewEnabled,
      soundEnabled: soundEnabled ?? true,
      pushEventTypes: pushEventTypes ?? '[]',
    },
    update: {
      browserEnabled,
      previewEnabled,
      ...(pushEventTypes !== undefined ? { pushEventTypes } : {}),
      ...(soundEnabled !== undefined ? { soundEnabled } : {}),
    },
  })

  return NextResponse.json({
    ok: true,
    browserEnabled: saved.browserEnabled,
    previewEnabled: saved.previewEnabled,
    pushEventTypes: [...parsePushEventTypes(saved.pushEventTypes)],
    soundEnabled: saved.soundEnabled,
  })
}
