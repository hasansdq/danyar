import { LoginForm } from '@/components/login-form'
import { ensureSeeded } from '@/lib/bootstrap'

export const metadata = { title: 'ورود | دانیار' }

export default function LoginPage() {
  // پیش‌ترمیم: اگر دیتابیس بین‌جلسه‌ای خالی شده باشد، حساب‌های دمو پیش از تایپ کاربر بازمی‌گردند
  void ensureSeeded()
  return (
    <LoginForm
      realm="app"
      title="ورود به حساب کاربری"
      description="مدیر مدرسه، معلم و دانش‌آموز از این صفحه وارد شوند."
    />
  )
}
