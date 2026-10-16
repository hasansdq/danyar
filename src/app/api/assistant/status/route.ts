import { NextResponse } from 'next/server'
import { requireAppRole } from '@/lib/api-auth'
import { resolveAiStatus } from '@/lib/ai/access'

/** وضعیت واقعی دستیار برای کاربر جاری — پایه نمایش صادقانه وضعیت */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const status = await resolveAiStatus(res.session)
  return NextResponse.json({ status })
}
