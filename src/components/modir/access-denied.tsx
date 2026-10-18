import Link from 'next/link'
import { ShieldOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/** کارت «دسترسی محدود شده» — وقتی مدیر مدرسه این بخش را برای معاون بسته است */
export function ModirAccessDenied({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <ShieldOff className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="text-lg font-bold">دسترسی محدود شده است</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            مدیر مدرسه دسترسی «{what}» را برای حساب شما محدود کرده است.
            برای فعال‌سازی، با مدیر مدرسه خود تماس بگیرید.
          </p>
          <Button asChild variant="outline">
            <Link href="/modir">بازگشت به مدیریت مدرسه</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
