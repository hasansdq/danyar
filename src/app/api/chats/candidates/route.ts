import { NextResponse } from 'next/server'
import { requireAppRole } from '@/lib/api-auth'
import { listDmCandidates } from '@/lib/dm-candidates'

/** کاربرانی که کاربر فعلی می‌تواند با آن‌ها گفتگوی خصوصی شروع کند */
export async function GET() {
  const res = await requireAppRole()
  if ('response' in res) return res.response
  const result = await listDmCandidates(res.session)
  return NextResponse.json(result)
}
