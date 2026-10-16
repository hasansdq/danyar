import { db } from '@/lib/db'
import { after } from 'next/server'
import { notifySocket, roomForUser } from '@/lib/notify'
import {
  enqueuePushForNotifications,
  processPushQueueExclusive,
  type EnqueueRow,
} from '@/lib/push'

/**
 * ساخت اعلان درون‌برنامه‌ای برای چند کاربر + ارسال رویداد بلادرنگ.
 * - dedupeKey: هر رویداد فقط یک‌بار برای هر کاربر ثبت می‌شود (یکتا با userId)
 * - اگر سرویس socket در دسترس نباشد، اعلان در دیتابیس می‌ماند و هنگام
 *   باز شدن صفحه اعلان‌ها دیده می‌شود.
 */
export interface NotificationRow {
  userId: string
  type: string
  title: string
  body?: string
  link?: string | null
  dedupeKey?: string | null
}

export async function pushNotifications(rows: NotificationRow[]): Promise<void> {
  if (!rows.length) return

  // ضدتکرار دستی (SQLite از skipDuplicates پشتیبانی نمی‌کند):
  // کلیدهای موجود برای همان کاربران پیدا و حذف می‌شوند
  const dedupeKeys = [...new Set(rows.map((r) => r.dedupeKey).filter((k): k is string => !!k))]
  let freshRows = rows
  if (dedupeKeys.length) {
    const userIds = [...new Set(rows.map((r) => r.userId))]
    const existing = await db.notification.findMany({
      where: { userId: { in: userIds }, dedupeKey: { in: dedupeKeys } },
      select: { userId: true, dedupeKey: true },
    })
    const existingSet = new Set(existing.map((e) => `${e.userId}:${e.dedupeKey}`))
    freshRows = rows.filter(
      (r) => !r.dedupeKey || !existingSet.has(`${r.userId}:${r.dedupeKey}`),
    )
  }
  if (!freshRows.length) return

  const startedAt = new Date(Date.now() - 5_000)

  try {
    await db.notification.createMany({
      data: freshRows.map((r) => ({
        userId: r.userId,
        type: r.type,
        title: r.title,
        body: r.body ?? '',
        link: r.link ?? null,
        dedupeKey: r.dedupeKey ?? null,
      })),
    })
  } catch {
    // رقابتی: اگر بین بررسی و درج سطر تکراری ساخته شد، تک‌تک با چشم‌پوشی از تکراری‌ها درج می‌شود
    for (const r of freshRows) {
      await db.notification
        .create({
          data: {
            userId: r.userId,
            type: r.type,
            title: r.title,
            body: r.body ?? '',
            link: r.link ?? null,
            dedupeKey: r.dedupeKey ?? null,
          },
        })
        .catch(() => null)
    }
  }

  // صف پوش نوتیفیکیشن مرورگر — پس از ارسال پاسخ پردازش می‌شود تا
  // مسیر اصلی ثبت پیام/تکلیف کند نشود؛ خطای پوش هرگز این مسیر را شکست نمی‌دهد.
  // اعلان پوش از روی همان ردیف‌های اعلان درون‌برنامه‌ای ساخته می‌شود
  // (سیستم موازی/تکراری نیست) و شناسه یکتای رویداد همان شناسه اعلان است.
  schedulePushFor(freshRows, startedAt)

  // رویداد بلادرنگ: اگر همه سطرها محتوای یکسانی دارند یک emit مشترک کافی است
  const first = freshRows[0]
  const sameShape = freshRows.every(
    (r) =>
      r.type === first.type &&
      r.title === first.title &&
      (r.body ?? '') === (first.body ?? '') &&
      (r.link ?? null) === (first.link ?? null),
  )
  if (sameShape) {
    await notifySocket({
      rooms: freshRows.map((r) => roomForUser(r.userId)),
      event: 'notification:new',
      data: {
        type: first.type,
        title: first.title,
        body: first.body ?? '',
        link: first.link ?? null,
      },
    })
  } else {
    for (const r of freshRows) {
      await notifySocket({
        rooms: [roomForUser(r.userId)],
        event: 'notification:new',
        data: {
          type: r.type,
          title: r.title,
          body: r.body ?? '',
          link: r.link ?? null,
        },
      })
    }
  }
}

/**
 * فیلتر کاربرانی که این گفتگو را بی‌صدا کرده‌اند — برای پیام‌های جدید.
 * بی‌صدا یعنی اعلان درون‌برنامه‌ای و مرورگری برای آن گفتگو ساخته نمی‌شود.
 */
export async function filterMutedUsers(
  userIds: string[],
  chatType: 'GROUP' | 'DIRECT',
  chatKey: string,
): Promise<Set<string>> {
  if (!userIds.length) return new Set()
  const muted = await db.mutedChat.findMany({
    where: { userId: { in: userIds }, chatType, chatKey },
    select: { userId: true },
  })
  return new Set(muted.map((m) => m.userId))
}

/**
 * شنوندگان واقعی یک گروه درسی — پیاده‌سازی در ماژول مشترک group-audience
 * (بدون وابستگی حلقوی با هسته پوش)
 */
export { effectiveGroupAudience } from '@/lib/group-audience'

/**
 * زمان‌بندی ارسال پوش برای ردیف‌های اعلان تازه.
 * - شناسه‌های واقعی اعلان‌های درج‌شده بازیابی و به‌عنوان شناسه یکتای رویداد استفاده می‌شود
 * - اجرا با after(): پس از ارسال پاسخ HTTP؛ اگر خارج از زمینه درخواست بودیم،
 *   به‌صورت fire-and-forget اجرا می‌شود
 * - هر خطا فقط لاگ می‌شود؛ مسیر اصلی هرگز شکست نمی‌خورد
 */
function schedulePushFor(
  rows: { userId: string; type: string; dedupeKey?: string | null }[],
  startedAt: Date,
): void {
  const load = async () => {
    try {
      const userIds = [...new Set(rows.map((r) => r.userId))]
      const dedupeKeys = [...new Set(rows.map((r) => r.dedupeKey).filter((k): k is string => !!k))]
      const types = [...new Set(rows.map((r) => r.type))]

      const created = await db.notification.findMany({
        where: {
          userId: { in: userIds },
          type: { in: types },
          createdAt: { gte: startedAt },
          // اشتراک شیء، نه آرایه — آرایه کلید عددی می‌سازد و کوئری نامعتبر می‌شود
          ...(dedupeKeys.length ? { dedupeKey: { in: dedupeKeys } } : {}),
        },
        select: { id: true, userId: true, type: true, dedupeKey: true },
        take: 1000,
      })

      const wanted = new Set(rows.filter((r) => r.dedupeKey).map((r) => `${r.userId}:${r.dedupeKey}`))
      const candidates = created.filter(
        (n) =>
          (n.dedupeKey && wanted.has(`${n.userId}:${n.dedupeKey}`)) ||
          (!n.dedupeKey && rows.some((r) => !r.dedupeKey && r.userId === n.userId && r.type === n.type)),
      )
      // پیام اطلاعیه مدیر مدرسه در گروه، هم اعلان SCHOOL_ANNOUNCEMENT دارد و
      // هم پیام گروهی محسوب می‌شود — برای جلوگیری از دو پوش جدا، پوشِ GROUP_MESSAGE
      // آن پیام حذف می‌شود (اعلان درون‌برنامه هر دو باقی می‌ماند)
      const announcementMsgIds = candidates
        .filter((n) => n.type === 'GROUP_MESSAGE' && (n.dedupeKey ?? '').startsWith('msg:'))
        .map((n) => (n.dedupeKey ?? '').slice(4))
      const announcementSet = new Set<string>()
      if (announcementMsgIds.length) {
        const annMsgs = await db.message.findMany({
          where: { id: { in: announcementMsgIds }, isAnnouncement: true },
          select: { id: true },
        })
        for (const m of annMsgs) announcementSet.add(`msg:${m.id}`)
      }
      const fresh: EnqueueRow[] = candidates
        .filter((n) => !(n.type === 'GROUP_MESSAGE' && announcementSet.has(n.dedupeKey ?? '')))
        .map((n) => ({ notificationId: n.id, userId: n.userId, type: n.type }))

      if (!fresh.length) return
      const enqueued = await enqueuePushForNotifications(fresh)
      if (enqueued > 0) await processPushQueueExclusive()
    } catch (e) {
      console.error('[push] enqueue/processing failed:', e instanceof Error ? e.message : e)
    }
  }

  try {
    after(load)
  } catch {
    // خارج از زمینه درخواست (مثلاً اسکریپت) — fire-and-forget
    void load()
  }
}
