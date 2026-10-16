import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'
import { serveStoredFile } from '@/lib/serve-file'

export const runtime = 'nodejs'

type Params = { params: Promise<{ key: string }> }

/**
 * GET /api/admin/media/[key]/file — سرو فایل برای مدیر کل
 * - پیش‌نمایش در گالری: ?preview=1 → شمارش نمی‌شود
 * - دانلود واقعی: ?dl=1 → content-disposition: attachment + شمارش
 */
export async function GET(
  req: NextRequest,
  { params }: Params,
) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { key } = await params

  const row = await db.upload.findUnique({ where: { key: path.basename(key) } })
  if (!row) {
    return NextResponse.json({ error: 'رسانه یافت نشد' }, { status: 404 })
  }

  const preview = req.nextUrl.searchParams.get('preview') === '1'
  const download = req.nextUrl.searchParams.get('dl') === '1'

  return serveStoredFile(req, row.key, row.mime, row.name, {
    // پیش‌نمایش مدیر هرگز آمار دانلود را خراب نمی‌کند
    count: !preview,
    disposition: download ? 'attachment' : 'inline',
  })
}
