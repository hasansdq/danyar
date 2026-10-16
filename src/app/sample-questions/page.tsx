import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { SampleQClient } from '@/components/sample-questions/sampleq-client'

/**
 * صفحه نمونه‌سؤالات — بخش مستقل در منوی موبایل و دسکتاپ:
 * - معلم: ایجاد نمونه‌سؤال چندکلاسه با فایل و پاسخ‌نامه، ویرایش و انتشار
 * - دانش‌آموز: نمونه‌سؤالات منتشرشده کلاس خودش با جست‌وجو، فیلتر و نشان‌گذاری
 * - مدیر مدرسه: همه نمونه‌سؤالات مدرسه با فیلتر و مدیریت
 */
export default async function SampleQuestionsPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <SampleQClient role={session.role} />
    </AppShell>
  )
}
