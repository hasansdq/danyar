import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'

export const runtime = 'nodejs'

/**
 * POST /api/admin/branding/upload?type=logo|splash|chatbg|chatbgdark|font
 * آپلود assetهای برندینگ (فقط مدیر کل):
 *  - logo / splash / chatbg / chatbgdark → تصویر (png/jpg/jpeg/webp/svg/gif)
 *  - font → woff2/woff/ttf/otf
 * فایل در پوشه امن uploads/branding با نام تصادفی ذخیره می‌شود و «کلید» آن
 * (branding/...) برگردانده می‌شود تا با PATCH /api/admin/branding ثبت شود.
 */

type AssetType = 'logo' | 'splash' | 'chatbg' | 'chatbgdark' | 'font'

const IMAGE_TYPES: AssetType[] = ['logo', 'splash', 'chatbg', 'chatbgdark']

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
}
const FONT_EXT: Record<string, string> = {
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'application/font-woff': 'woff',
  'font/ttf': 'ttf',
  'application/x-font-ttf': 'ttf',
  'font/otf': 'otf',
  'application/x-font-otf': 'otf',
  'application/octet-stream': '', // با پسوند فایل تشخیص داده می‌شود
}
const FONT_EXT_BY_NAME = ['woff2', 'woff', 'ttf', 'otf']

const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // ۵MB — پس‌زمینه موبایل ۱۰۸۰×۱۹۲۰
const MAX_LOGO_BYTES = 2 * 1024 * 1024 // ۲MB
const MAX_FONT_BYTES = 10 * 1024 * 1024 // ۱۰MB

function assetDir(): string {
  return path.join(process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads'), 'branding')
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin()
  if ('response' in auth) return auth.response

  const type = (req.nextUrl.searchParams.get('type') ?? '') as AssetType
  if (![...IMAGE_TYPES, 'font'].includes(type)) {
    return jsonError('نوع فایل نامعتبر است', 400)
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return jsonError('فایلی ارسال نشده است', 400)
  if (file.size === 0) return jsonError('فایل خالی است', 400)

  const isImage = IMAGE_TYPES.includes(type)
  const maxBytes = type === 'font' ? MAX_FONT_BYTES : type === 'logo' ? MAX_LOGO_BYTES : MAX_IMAGE_BYTES
  if (file.size > maxBytes) {
    return jsonError(
      `حجم فایل بیش از حد مجاز است (حداکثر ${Math.round(maxBytes / 1024 / 1024)} مگابایت)`,
      413,
    )
  }

  // پسوند از mime یا نام فایل — برای هر نوع فقط فرمت‌های مجاز همان دسته پذیرفته می‌شوند
  let ext = ''
  if (isImage) {
    ext = IMAGE_EXT[file.type] ?? ''
    if (!ext) {
      const byName = (file.name.split('.').pop() ?? '').toLowerCase()
      ext = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif'].includes(byName) ? (byName === 'jpeg' ? 'jpg' : byName) : ''
    }
  } else {
    ext = FONT_EXT[file.type] ?? ''
    if (!ext) {
      const byName = (file.name.split('.').pop() ?? '').toLowerCase()
      ext = FONT_EXT_BY_NAME.includes(byName) ? byName : ''
    }
  }
  if (!ext) {
    return jsonError(
      isImage ? 'فرمت تصویر نامعتبر است (png/jpg/webp/svg/gif)' : 'فرمت فونت نامعتبر است (woff2/woff/ttf/otf)',
      415,
    )
  }

  const name = `${type}-${randomUUID()}.${ext}`
  const dir = assetDir()
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({
    key: `branding/${name}`,
    url: `/api/branding/asset/${name}`,
  })
}
