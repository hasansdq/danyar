import { LoginForm } from '@/components/login-form'

export const metadata = { title: 'ورود مدیر کل | دانیار' }

export default function SuperAdminLoginPage() {
  return (
    <LoginForm
      realm="superadmin"
      title="ورود مدیر کل پلتفرم"
      description="این بخش فقط برای مدیر کل دانیار است."
    />
  )
}
