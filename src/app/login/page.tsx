import { LoginForm } from '@/components/login-form'

export const metadata = { title: 'ورود | دانیار' }

export default function LoginPage() {
  return (
    <LoginForm
      realm="app"
      title="ورود به حساب کاربری"
      description="مدیر مدرسه، معلم و دانش‌آموز از این صفحه وارد شوند."
    />
  )
}
