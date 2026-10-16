'use client'

import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * سوئیچ تم بدون state اضافه — نمایش آیکون با CSS تا از عدم تطابق hydration جلوگیری شود.
 */
export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="تغییر حالت روشن و تاریک"
      title="تغییر حالت روشن/تاریک"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <Sun className="h-5 w-5 dark:hidden" />
      <Moon className="h-5 w-5 hidden dark:block" />
    </Button>
  )
}
