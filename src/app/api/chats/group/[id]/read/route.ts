import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAppRole } from '@/lib/api-auth'
import { getAccessibleGroup } from '@/lib/chat-access'

type Params = { params: Promise<{ id: string }> }

/** علامت‌گذاری گروه به‌عنوان خوانده‌شده */
export async function POST(_req: NextRequest, { params }: Params) {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const { id } = await params

  const group = await getAccessibleGroup(res.session, id)
  if (!group) return NextResponse.json({ ok: false }, { status: 404 })

  await db.groupReadState.upsert({
    where: {
      userId_subjectGroupId: { userId: res.session.uid, subjectGroupId: id },
    },
    create: { userId: res.session.uid, subjectGroupId: id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
