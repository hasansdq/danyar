import { NextRequest, NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  ID_FIELDS,
  BACKUP_SECTIONS,
  orderedSelectedSections,
  reverseSections,
} from '@/lib/backup-catalog'

export const runtime = 'nodejs'

/**
 * ایمپورت بکاپ (درخواست کاربر): POST /api/admin/backup/import
 * بدنه: FormData → file (فایل JSON بکاپ) + mode (merge | replace)
 *  - merge (پیش‌فرض): ردیف موجود با همان شناسه به‌روزرسانی، جدید ایجاد می‌شود
 *  - replace: ردیف‌های همان بخش‌ها اول حذف (ترتیب معکوس وابستگی) سپس ایجاد
 * همهٔ عملیات داخل یک تراکنش اتمیک — خطا = بازگشت کامل (بدون تغییر نیمه‌کاره).
 * کاربر مدیر کلِ فعال هرگز حذف نمی‌شود (قفل‌شدن پنل جلوگیری می‌شود).
 */

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

interface SectionReport {
  inserted: number
  updated: number
  skipped: number
  models: Record<string, { inserted: number; updated: number; skipped: number }>
}

/** آیا خطای Prisma مربوط به FK گمشده یا نقض unique است؟ → ردیف skip می‌شود */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRowConflict(e: any): boolean {
  const code = e?.code ?? e?.error?.code
  // P2003 = FK گمشده · P2002 = نقض unique
  return code === 'P2003' || code === 'P2002'
}

interface BackupRow {
  [k: string]: unknown
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if ('response' in guard) return guard.response
  const session = guard.session

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: 'فایل بکاپ ارسال نشده است' }, { status: 400 })
  }
  const mode = String(form.get('mode') ?? 'merge') === 'replace' ? 'replace' : 'merge'

  let payload: {
    format?: string
    version?: number
    createdAt?: string
    sections?: Record<string, Record<string, BackupRow[]>>
    files?: Record<string, { name: string; mime: string; b64: string }>
  }
  try {
    payload = JSON.parse(await file.text())
  } catch {
    return NextResponse.json({ error: 'فایل JSON نامعتبر است' }, { status: 400 })
  }

  if (payload.format !== BACKUP_FORMAT || typeof payload.version !== 'number') {
    return NextResponse.json(
      { error: 'این فایل یک بکاپ معتبر دانیار نیست' },
      { status: 400 },
    )
  }
  if (payload.version > BACKUP_VERSION) {
    return NextResponse.json(
      { error: `نسخهٔ بکاپ (${payload.version}) از نسخهٔ پشتیبانی‌شده جدیدتر است` },
      { status: 400 },
    )
  }
  const sectionsData = payload.sections ?? {}
  const selectedKeys = Object.keys(sectionsData)
  if (selectedKeys.length === 0) {
    return NextResponse.json({ error: 'بکاپ هیچ بخشی ندارد' }, { status: 400 })
  }
  // فقط بخش‌های شناخته‌شده — به ترتیب وابستگی امن
  const validSections = orderedSelectedSections(selectedKeys)
  if (validSections.length === 0) {
    return NextResponse.json({ error: 'بخش‌های این بکاپ شناخته شده نیستند' }, { status: 400 })
  }

  const report: Record<string, SectionReport> = {}
  let filesRestored = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any

  try {
    const result = await db.$transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (tx: any) => {
        // ── حالت جایگزینی: پاک‌سازی بخش‌های انتخابی (ترتیب معکوس وابستگی) ──
        if (mode === 'replace') {
          for (const section of reverseSections(validSections)) {
            for (const model of section.models) {
              if (model === 'user') {
                // مدیر کلِ فعال هرگز حذف نمی‌شود — قفل‌شدن پنل غیرممکن است
                await tx.user.deleteMany({ where: { id: { not: session.uid } } })
              } else {
                await tx[model].deleteMany()
              }
            }
          }
        }

        // ── درج/به‌روزرسانی به ترتیب وابستگی ──
        for (const section of validSections) {
          const secReport: SectionReport = {
            inserted: 0,
            updated: 0,
            skipped: 0,
            models: {},
          }
          const secData = sectionsData[section.key] ?? {}
          for (const model of section.models) {
            const idField = ID_FIELDS[model] ?? 'id'
            const rows = secData[model] ?? []
            const mReport = { inserted: 0, updated: 0, skipped: 0 }
            for (const row of rows) {
              const id = row[idField]
              if (typeof id !== 'string' && typeof id !== 'number') {
                mReport.skipped++
                continue
              }
              // مدیر کلِ فعال از بکاپ هم بازنویسی نمی‌شود (نشست و رمز فعلی محفوظ می‌ماند)
              if (model === 'user' && id === session.uid) {
                mReport.skipped++
                continue
              }
              try {
                const existing = await tx[model].findUnique({ where: { [idField]: id } })
                if (existing) {
                  if (mode === 'merge') {
                    const data = { ...row }
                    delete data[idField]
                    await tx[model].update({ where: { [idField]: id }, data })
                    mReport.updated++
                  } else {
                    // replace: id تکراری داخل خود فایل
                    mReport.skipped++
                  }
                } else {
                  await tx[model].create({ data: row })
                  mReport.inserted++
                }
              } catch (e) {
                // FK گمشده (بخش وابسته در بکاپ نبود) یا نقض unique — skip
                if (!isRowConflict(e)) throw e
                mReport.skipped++
              }
            }
            secReport.models[model] = mReport
            secReport.inserted += mReport.inserted
            secReport.updated += mReport.updated
            secReport.skipped += mReport.skipped
          }
          report[section.key] = secReport
        }
        return true
      },
      { timeout: 180_000, maxWait: 20_000 },
    )
    if (!result) throw new Error('transaction failed')

    // ── بازگردانی فایل‌های رسانه (خارج از تراکنش — فایل‌ها idempotent هستند) ──
    const files = payload.files ?? {}
    if (Object.keys(files).length > 0) {
      const dir = uploadDir()
      await mkdir(dir, { recursive: true })
      for (const [key, entry] of Object.entries(files)) {
        if (!/^[A-Za-z0-9._-]+$/.test(key)) continue // مسیر امن — بدون پیمایش دایرکتوری
        if (typeof entry?.b64 !== 'string') continue
        try {
          const buf = Buffer.from(entry.b64, 'base64')
          await writeFile(path.join(dir, key), buf)
          filesRestored++
        } catch {
          /* فایل نوشته نشد — ردیف دیتابیس وجود دارد */
        }
      }
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: 'ایمپورت شکست خورد — هیچ تغییری اعمال نشد (تراکنش بازگشت)',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detail: (e as any)?.message ?? String(e),
      },
      { status: 500 },
    )
  }

  const labels = Object.fromEntries(BACKUP_SECTIONS.map((s) => [s.key, s.label]))
  return NextResponse.json({
    ok: true,
    mode,
    backupCreatedAt: payload.createdAt ?? null,
    report,
    labels,
    filesRestored,
  })
}
