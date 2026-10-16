'use client'

import { ReactNode } from 'react'
import { MessengerList } from './messenger-list'

/**
 * چیدمان دو ستونی پیام‌رسان:
 * دسکتاپ: فهرست گفتگوها + گفتگوی انتخاب‌شده کنار هم
 * موبایل: فقط یکی از دو ناحیه (فهرست در خانه، گفتگو در صفحه خودش)
 */
export function ChatSplit({
  children,
  listOnMobile = false,
  currentKey,
}: {
  children: ReactNode
  listOnMobile?: boolean
  currentKey?: string
}) {
  return (
    <div className="flex flex-1 min-h-0 w-full">
      <aside
        className={
          listOnMobile
            ? 'flex flex-col w-full lg:w-[330px] lg:shrink-0 lg:border-l bg-card min-h-0'
            : 'hidden lg:flex lg:flex-col lg:w-[330px] shrink-0 border-l bg-card min-h-0'
        }
      >
        <MessengerList currentKey={currentKey} />
      </aside>
      <section className="flex-1 flex flex-col min-w-0 min-h-0">{children}</section>
    </div>
  )
}
