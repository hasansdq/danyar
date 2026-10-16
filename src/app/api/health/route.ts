import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/health — healthcheck واقعی برای اورکستراسیون (Docker healthcheck / پراکسی).
 * ۲۰۰ فقط وقتی: اتصال دیتابیس برقرار است (SELECT 1 واقعی).
 * هیچ اطلاعات حساسی برنمی‌گرداند؛ پاسخ کش نمی‌شود (هدر no-store سراسری /api/*).
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true, db: 'ok' })
  } catch {
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503 })
  }
}
