import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { db } from '@/lib/db'

/** مسیر ذخیره‌سازی دائمی فایل‌ها */
export function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

/**
 * شمارش دریافت کامل فایل — هر پاسخ ۲۰۰ (بدون Range) یک شمارش؛
 * قطعات ۲۰۶ پخش روان و پیش‌نمایش‌های مدیریتی شمرده نمی‌شوند.
 * آتش‌و-فراموش: خطای شمارش هرگز سرو فایل را ناموفق نمی‌کند.
 */
export function countDownload(key: string): void {
  db.upload
    .update({ where: { key }, data: { downloadCount: { increment: 1 } } })
    .catch(() => null)
}

/**
 * سرو امن فایل ذخیره‌شده روی دیسک (با پشتیبانی Range برای پخش صوت/ویدئو).
 * فراخوانی فقط پس از بررسی دسترسی سمت سرور انجام شود.
 */
export async function serveStoredFile(
  req: NextRequest,
  key: string,
  mime: string,
  displayName: string,
  opts: { count?: boolean; disposition?: 'inline' | 'attachment' } = {},
): Promise<NextResponse> {
  const safeKey = path.basename(key)
  const filePath = path.join(uploadDir(), safeKey)
  let fileStat
  try {
    fileStat = await stat(filePath)
    if (!fileStat.isFile()) throw new Error('not a file')
  } catch {
    return NextResponse.json({ error: 'فایل یافت نشد' }, { status: 404 })
  }

  const name = displayName.replace(/["\r\n]/g, '')
  const encodedName = encodeURIComponent(name)
  const dispositionKind = opts.disposition ?? 'inline'

  const baseHeaders: Record<string, string> = {
    'content-type': mime,
    'content-disposition': `${dispositionKind}; filename*=UTF-8''${encodedName}`,
    'cache-control': 'private, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  }

  const range = req.headers.get('range')
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? Math.min(parseInt(m[2], 10), fileStat.size - 1) : fileStat.size - 1
      if (start >= fileStat.size || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'content-range': `bytes */${fileStat.size}` },
        })
      }
      const stream = createReadStream(filePath, { start, end })
      return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'content-range': `bytes ${start}-${end}/${fileStat.size}`,
          'content-length': String(end - start + 1),
        },
      })
    }
  }

  // دریافت کامل → شمارش (مگر صریحاً غیرفعال مثل پیش‌نمایش مدیر)
  if (opts.count !== false) countDownload(safeKey)
  const stream = createReadStream(filePath)
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, 'content-length': String(fileStat.size) },
  })
}
