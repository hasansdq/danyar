import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/api-auth'
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  FULL_BACKUP_SECTIONS,
  orderedSelectedSections,
} from '@/lib/backup-catalog'

export const runtime = 'nodejs'

/**
 * بکاپ‌گیری انتخابی (درخواست کاربر): GET /api/admin/backup?sections=users,media|all
 * خروجی: فایل JSON قابل دانلود با فرمت daniar-backup — هر بخش جداگانه یا «کل سایت».
 * رسانه‌ها: ردیف‌های Upload + خود فایل‌ها به‌صورت base64.
 * کدهای یکبارمصرف ورود (OtpCode) به دلایل امنیتی هرگز وارد بکاپ نمی‌شوند.
 */

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

interface BackupFileEntry {
  name: string
  mime: string
  b64: string
}

export async function GET(req: NextRequest) {
  const res = await requireSuperAdmin()
  if ('response' in res) return res.response

  const sp = req.nextUrl.searchParams
  const raw = sp.get('sections') ?? ''
  const requested = raw
    .split(',')
    .map((s) => s.trim())
      .filter(Boolean)
  const isAll = requested.includes('all') || requested.length === 0
  const effective = orderedSelectedSections(
    isAll ? FULL_BACKUP_SECTIONS : requested,
  )

  if (effective.length === 0) {
    return NextResponse.json({ error: 'هیچ بخشی برای بکاپ انتخاب نشده است' }, { status: 400 })
  }

  const data: Record<string, Record<string, unknown[]>> = {}
  const counts: Record<string, number> = {}
  const files: Record<string, BackupFileEntry> = {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any

  for (const section of effective) {
    const sectionData: Record<string, unknown[]> = {}
    let total = 0
    for (const model of section.models) {
      const rows = await client[model].findMany()
      sectionData[model] = rows
      total += rows.length

      // فایل‌های فیزیکی رسانه‌ها — base64
      if (section.files && model === 'upload') {
        for (const row of rows as { key: string; name: string; mime: string }[]) {
          try {
            const buf = await readFile(path.join(uploadDir(), row.key))
            files[row.key] = {
              name: row.name,
              mime: row.mime,
              b64: buf.toString('base64'),
            }
          } catch {
            /* فایل روی دیسک نیست — ردیف بدون فایل بکاپ می‌شود */
          }
        }
      }
    }
    data[section.key] = sectionData
    counts[section.key] = total
  }

  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const fileDate = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
  const fileName = `daniar-backup-${isAll ? 'full' : effective.map((s) => s.key).join('+')}-${fileDate}.json`

  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: stamp.toISOString(),
    sections: data,
    files,
    counts,
    fileCount: Object.keys(files).length,
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}
