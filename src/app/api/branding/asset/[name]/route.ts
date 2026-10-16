import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { getPlatformSettings } from '@/lib/branding'

export const runtime = 'nodejs'

/**
 * GET /api/branding/asset/[name] — سرو assetهای برندینگ (عمومی)
 * فقط فایل‌های داخل پوشه امن uploads/branding با نام منطبق بر الگو سرو می‌شود؛
 * هیچ مسیر دیگری از دیسک قابل دسترسی نیست (جلوگیری کامل از path traversal).
 */
const NAME_RE = /^[a-z0-9-]+\.(woff2|woff|ttf|otf|png|jpg|jpeg|webp|svg|gif)$/i

const MIME: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
}

function assetDir(): string {
  return path.join(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'), 'branding')
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name: raw } = await params
  const name = decodeURIComponent(raw ?? '')
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  // حتی با الگو، escape مسیر را هم صریح می‌بندیم
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // فایل باید واقعاً در تنظیمات یا فونت آپلودیِ فعال ارجاع داشته باشد؟ —
  // لوگو/اسپلش/پس‌زمینه باید پیش از ثبت هم قابل پیش‌نمایش باشند؛ فقط نام امن است،
  // پس سرو مستقیم فایل‌های پوشه امن کافی و بی‌خطر است.
  const filePath = path.join(assetDir(), name)
  try {
    const st = await stat(filePath)
    if (!st.isFile()) throw new Error('not a file')
    const ext = (name.split('.').pop() ?? '').toLowerCase()
    const mime = MIME[ext] ?? 'application/octet-stream'
    const buf = await readFile(filePath)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': mime,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}

// ارجاع تنظیمات برای اطمینان از لود lib (بدون اثر عملکردی)
void getPlatformSettings
