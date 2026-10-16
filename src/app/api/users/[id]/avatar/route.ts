import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/api-auth'
import { serveStoredFile } from '@/lib/serve-file'

type Params = { params: Promise<{ id: string }> }

/** GET /api/users/[id]/avatar — تصویر کاربر هم‌مدرسه‌ای (با احراز هویت و جداسازی مدرسه) */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAuth()
  if ('response' in res) return res.response
  const session = res.session
  const { id } = await params

  const user = await db.user.findFirst({
    where: { id, schoolId: session.schoolId },
    select: { avatarKey: true, avatarMime: true },
  })
  if (!user?.avatarKey) {
    return new NextResponse(null, { status: 404 })
  }
  return serveStoredFile(req, user.avatarKey, user.avatarMime ?? 'image/jpeg', 'avatar')
}
