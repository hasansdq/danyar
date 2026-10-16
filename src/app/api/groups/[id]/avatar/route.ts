import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import { getAccessibleGroup } from '@/lib/chat-access'
import { serveStoredFile } from '@/lib/serve-file'

type Params = { params: Promise<{ id: string }> }

/** GET /api/groups/[id]/avatar — تصویر پروفایل گروه درسی (برای اعضا/معلم/مدیر همان گروه) */
export async function GET(req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const { id } = await params

  const group = await getAccessibleGroup(res.session, id)
  if (!group || !group.avatarKey) {
    return new NextResponse(null, { status: 404 })
  }
  return serveStoredFile(
    req,
    group.avatarKey,
    group.avatarMime ?? 'image/jpeg',
    'group-avatar',
  )
}
