import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/api-auth'
import { serveStoredFile } from '@/lib/serve-file'

/** GET /api/me/avatar — تصویر پروفایل کاربر جاری (با احراز هویت) */
export async function GET(req: NextRequest) {
  const res = await requireAuth()
  if ('response' in res) return res.response

  const user = await db.user.findUnique({
    where: { id: res.session.uid },
    select: { avatarKey: true, avatarMime: true },
  })
  if (!user?.avatarKey) {
    return new NextResponse(null, { status: 404 })
  }
  return serveStoredFile(req, user.avatarKey, user.avatarMime ?? 'image/jpeg', 'avatar')
}
