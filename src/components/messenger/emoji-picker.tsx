'use client'

import { useState } from 'react'
import { Smile, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

/** دسته‌های ایموجی — مجموعه منتخب بدون وابستگی خارجی */
const CATEGORIES: { key: string; label: string; icon: string; emojis: string[] }[] = [
  {
    key: 'faces',
    label: 'صورتک‌ها',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '😊',
      '😇', '🙂', '😉', '😍', '🥰', '😘', '😗', '😚', '😋', '😛',
      '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏',
      '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩',
      '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵',
      '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫',
      '🤥', '😶', '😐', '😑', '😬', '🙄', '😲', '😴', '🤤', '😪',
      '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑',
    ],
  },
  {
    key: 'gestures',
    label: 'ژست‌ها',
    icon: '👍',
    emojis: [
      '👍', '👎', '👌', '🤌', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '👇', '☝️', '🫵', '👋', '🤚', '🖐️', '✋',
      '🖖', '🫱', '🫲', '🫳', '🫴', '👏', '🙌', '🫶', '🤲', '🙏',
      '✍️', '💅', '🤳', '💪', '🦾', '🫡', '🤝', '👊', '✊', '🤛',
    ],
  },
  {
    key: 'hearts',
    label: 'قلب‌ها',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💖',
      '💗', '💓', '💞', '💕', '💘', '💝', '💟', '❣️', '💔', '❤️‍🔥',
      '💯', '💥', '💫', '✨', '🌟', '⭐', '🔥', '🎉', '🎊', '🎈',
    ],
  },
  {
    key: 'school',
    label: 'مدرسه',
    icon: '📚',
    emojis: [
      '📚', '📖', '📗', '📘', '📙', '📓', '📔', '📒', '📝', '✏️',
      '🖊️', '🖋️', '🖊', '📌', '📍', '🖇️', '📐', '📏', '✂️', '🗑️',
      '🎒', '🏫', '🍎', '🧮', '🔬', '🔭', '🌍', '🎨', '🎵', '🎶',
      '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '📋', '📊', '📈', '💡',
      '🧠', '🔔', '⏰', '📅', '✅', '❌', '❓', '❗', '⭕', '🆗',
    ],
  },
  {
    key: 'objects',
    label: 'اشیاء',
    icon: '💬',
    emojis: [
      '💬', '💭', '🗯️', '📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '📸',
      '🎥', '🎬', '🎧', '🎤', '📻', '📎', '🔗', '🌐', '📧', '📩',
      '📤', '📥', '📦', '🔒', '🔑', '🗝️', '🛠️', '⚙️', '🧲', '🎁',
      '☕', '🍵', '🥤', '⚽', '🏀', '🎮', '🚀', '🌱', '🌸', '🍀',
    ],
  },
]

interface EmojiPickerProps {
  /** ایموجی انتخاب‌شده به کامپوزر اضافه می‌شود — پنل برای انتخاب چندتایی باز می‌ماند */
  onPick: (emoji: string) => void
  disabled?: boolean
}

/**
 * انتخابگر ایموجی کنار کامپوزر — پاپ‌آور با دسته‌بندی، درج در محل نشانگر؛
 * پس از انتخاب هر ایموجی پنل باز می‌ماند (انتخاب چندتایی) و با لمس/کلیک
 * بیرون از پنل، دکمه بستن یا Esc بسته می‌شود.
 */
export function EmojiPicker({ onPick, disabled }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState(CATEGORIES[0].key)
  const active = CATEGORIES.find((c) => c.key === cat) ?? CATEGORIES[0]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          disabled={disabled}
          aria-label="افزودن ایموجی"
          title="ایموجی"
        >
          <Smile className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-72 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // درج ایموجی فوکوس را به textarea برمی‌گرداند — حرکت فوکوس نباید پنل را ببندد
        // (انتخاب چندتایی)؛ بستن فقط با لمس/کلیک بیرون، دکمه بستن یا Esc
        onFocusOutside={(e) => e.preventDefault()}
        // بستن با لمس/کلیک بیرون پنل (رفتار پیش‌فرض رادیکس — صریح تکرار شده تا روی موبایل هم تضمین شود)
        onPointerDownOutside={() => setOpen(false)}
        onEscapeKeyDown={() => setOpen(false)}
      >
        {/* نوار عنوان + بستن — راه بستن قطعی روی موبایل */}
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">ایموجی‌ها</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="بستن ایموجی‌ها"
            title="بستن"
            className="h-6 w-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground flex items-center justify-center transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {/* شبکه ایموجی — انتخاب چندتایی بدون بستن پنل */}
        <div className="max-h-56 overflow-y-auto p-2" dir="ltr">
          <div className="grid grid-cols-8 gap-0.5">
            {active.emojis.map((em, i) => (
              <button
                key={`${cat}-${i}`}
                type="button"
                className="h-9 w-9 text-xl rounded-lg hover:bg-accent active:bg-primary/20 transition-colors flex items-center justify-center"
                onClick={() => onPick(em)}
                aria-label={`ایموجی ${em}`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
        {/* دسته‌ها */}
        <div className="border-t flex items-center justify-around px-1 py-1" dir="rtl">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(c.key)}
              aria-label={c.label}
              title={c.label}
              className={cn(
                'h-8 w-8 rounded-lg text-lg flex items-center justify-center transition-colors',
                cat === c.key ? 'bg-primary/15 ring-1 ring-primary/40' : 'hover:bg-accent',
              )}
            >
              {c.icon}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
