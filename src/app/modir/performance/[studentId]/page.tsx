import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { db } from '@/lib/db'
import { AppShell } from '@/components/app-shell'
import { StudentPerformanceDetail } from '@/components/performance/student-performance-detail'

export const metadata = { title: 'ریز گزارش عملکرد دانش‌آموز | دانیار' }

/**
 * ریز گزارش عملکرد دانش‌آموز (درخواست کاربر) — مقصد کلیک روی هر ردیف جدول
 * «گزارش عملکرد دانش‌آموزان» در هاب مدیریت مدرسه:
 * آمار + نمودار (روند نمرات، میانگین درس‌ها، وضعیت حضور، سبد ماهانه)
 * + تب‌های نمره‌ها/غیبت‌ها/تخلفات.
 * فقط مدیر/معاون مدرسه؛ دانش‌آموز باید متعلق به همان مدرسه باشد.
 */
export default async function StudentPerformancePage({
  params,
}: {
  params: Promise<{ studentId: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/admin')
  if (session.role !== 'SCHOOL_ADMIN' && session.role !== 'SCHOOL_VICE') redirect('/')

  const { studentId } = await params

  const student = await db.user.findUnique({
    where: { id: studentId },
    select: { id: true, schoolId: true, role: true },
  })
  if (!student || student.role !== 'STUDENT' || student.schoolId !== session.schoolId) {
    notFound()
  }

  return (
    <AppShell user={{ fullName: session.fullName, role: session.role }}>
      <StudentPerformanceDetail studentId={studentId} />
    </AppShell>
  )
}
