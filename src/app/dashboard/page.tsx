import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'

export const metadata = { title: 'داشبورد | دانیار' }

/**
 * داشبورد مستقل حذف شده است:
 *  - دانش‌آموز و معلم → فهرست گفتگوها
 *  - مدیر مدرسه → بخش مدیریت مدرسه (آمار مدرسه آنجا ادغام شده)
 *  - مدیر کل → پنل مدیریت مدارس
 */
export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role === 'SCHOOL_ADMIN' || session.role === 'SCHOOL_VICE') redirect('/modir')
  redirect('/')
}
