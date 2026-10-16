import { NextRequest, NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { requireSuperAdmin, jsonError } from '@/lib/api-auth'
import { uploadDir } from '@/lib/serve-file'

export const runtime = 'nodejs'

type Params = { params: Promise<{ key: string }> }

/**
 * DELETE /api/admin/media/[key] — حذف رسانه (فقط مدیر کل)
 * فایل از دیسک و ردیف از پایگاه داده حذف می‌شود؛
 * پیام‌ها/ارجاع‌های موجود به فایل دیگر سرو نمی‌شوند (۴۰۴).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: Params,
) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response
  const { key } = await params

  const safeKey = path.basename(key)
  const row = await db.upload.findUnique({ where: { key: safeKey } })
  if (!row) return jsonError('رسانه یافت نشد', 404)

  await unlink(path.join(uploadDir(), safeKey)).catch(() => null)
  await db.upload.delete({ where: { key: safeKey } })

  return NextResponse.json({ ok: true })
}
