import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { requireAppRole, jsonError } from '@/lib/api-auth'
import { getSchoolFeatures } from '@/lib/chat-access'
import {
  classifyWithSettings,
  formatRejectMessage,
  GB_BYTES,
  getMediaFormats,
  schoolQuotaGB,
  schoolUsageBytes,
} from '@/lib/media'

export const runtime = 'nodejs'

// فایل‌های مجاز نمونه‌سؤال: PDF، تصویر و Word رایج
const SAMPLEQ_EXTS = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp', 'gif'] as const

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

/** پاک‌سازی نام فایل برای نمایش امن */
function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'فایل'
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim()
  return (cleaned || 'فایل').slice(0, 120)
}

/**
 * آپلود فایل: اعتبارسنجی نوع/حجم بر اساس سیاست سراسری رسانه‌ها (پنل مدیر کل)،
 * سهمیه کل مدرسه، نام امن، ذخیره دائمی روی دیسک
 */
export async function POST(req: NextRequest) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const session = res.session

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return jsonError('فایلی ارسال نشده است')
  }

  // هدف آپلود: chat (پیام‌رسان) یا assignment (تکالیف) یا sampleq (نمونه‌سؤال) یا avatar (تصویر پروفایل)
  const purpose = String(form.get('purpose') ?? 'chat')
  const features = await getSchoolFeatures(session.schoolId)
  if (purpose === 'assignment') {
    if (!features.assignments) {
      return jsonError('تکالیف برای این مدرسه غیرفعال است', 403)
    }
  } else if (purpose === 'sampleq') {
    if (!features.sampleq) {
      return jsonError('نمونه‌سؤالات برای این مدرسه غیرفعال است', 403)
    }
    if (session.role !== 'TEACHER') {
      return jsonError('فقط معلم می‌تواند فایل نمونه‌سؤال آپلود کند', 403)
    }
  } else if (purpose === 'avatar') {
    // تصویر پروفایل — بدون گیت امکانات
  } else if (!features.chat) {
    return jsonError('پیام‌رسانی برای این مدرسه غیرفعال است', 403)
  }

  const displayName = safeDisplayName(file.name || 'فایل')
  const ext = (displayName.split('.').pop() ?? '').toLowerCase()

  // ─── سیاست رسانه‌ها: فرمت‌های مجاز و سقف حجم هر فرمت (پنل مدیر کل) ───
  const formats = await getMediaFormats()
  const cls = classifyWithSettings(file.type || '', ext, formats)
  const { type } = cls

  if (!type) {
    return jsonError('نوع فایل مجاز نیست', 415)
  }
  if (purpose === 'avatar' && type !== 'IMAGE') {
    return jsonError('تصویر پروفایل باید فایل تصویری باشد', 415)
  }
  if (purpose === 'sampleq' && !SAMPLEQ_EXTS.includes(ext as (typeof SAMPLEQ_EXTS)[number])) {
    return jsonError('برای نمونه‌سؤال فقط فایل PDF، تصویر یا Word مجاز است', 415)
  }
  if (file.size === 0) return jsonError('فایل خالی است')

  // تصویر پروفایل از گیت «فعال/غیرفعال» فرمت مستثناست ولی سقف حجم همان دسته را دارد؛
  // بقیه اهداف کامل تابع سیاست هستند
  if (!cls.allowed && purpose !== 'avatar') {
    return jsonError(formatRejectMessage(type), 415)
  }
  const maxBytes = (cls.maxMB ?? 0) * 1024 * 1024
  if (file.size > maxBytes) {
    return jsonError(
      `حجم فایل بیش از حد مجاز است (حداکثر ${cls.maxMB} مگابایت)`,
      413,
    )
  }

  // ─── سهمیه آپلود کل مدرسه (۰ = نامحدود) ───
  const quotaGB = await schoolQuotaGB(session.schoolId)
  if (quotaGB > 0) {
    const used = await schoolUsageBytes(session.schoolId)
    const quotaBytes = quotaGB * GB_BYTES
    if (used + file.size > quotaBytes) {
      const remainMB = Math.max(0, Math.floor((quotaBytes - used) / (1024 * 1024)))
      return jsonError(
        remainMB > 0
          ? `سهمیه آپلود مدرسه پر شده است — تنها ${remainMB} مگابایت باقی مانده`
          : 'سهمیه آپلود مدرسه تکمیل شده است؛ با مدیر پلتفرم تماس بگیرید',
        413,
      )
    }
  }

  const key = `${Date.now().toString(36)}-${randomUUID()}.${ext}`
  const dir = uploadDir()
  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(path.join(dir, key), buffer)

  await db.upload.create({
    data: {
      key,
      name: displayName,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      type,
      uploaderId: session.uid,
      // مدرسه مالک رسانه — مدیر کل مدرسه ندارد (null)
      schoolId: session.schoolId || null,
    },
  })

  return NextResponse.json(
    { key, name: displayName, mime: file.type, size: file.size, type },
    { status: 201 },
  )
}
