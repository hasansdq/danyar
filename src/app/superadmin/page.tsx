import { LoginForm } from '@/components/login-form'
import { ensureSeeded } from '@/lib/bootstrap'

export const metadata = { title: 'ورود مدیر کل | دانیار' }

export default function SuperAdminLoginPage() {
  // پیش‌ترمیم: اگر دیتابیس بین‌جلسه‌ای خالی شده باشد، حساب مدیر کل پیش از تایپ کاربر بازمی‌گردد
  void ensureSeeded()
  return (
    <LoginForm
      realm="superadmin"
      title="ورود مدیر کل پلتفرم"
      description="این بخش فقط برای مدیر کل دانیار است."
    />
  )
}
