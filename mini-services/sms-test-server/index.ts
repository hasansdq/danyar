/**
 * سرور آزمون پیامک — نقش «سرویس پیامک سازگار» را برای آزمون واقعی مسیر HTTP بازی می‌کند.
 * این سرور بخشی از اپلیکیشن نیست؛ فقط برای تست اتصال واقعی ارسال پیامک استفاده می‌شود.
 *
 * POST /send          ← درخواست ارسال (بدنه JSON) → 200 { ok: true }
 * GET  /messages      ← پیامک‌های دریافتی (برای تست: استخراج کد)
 * POST /reset         ← پاک‌سازی
 * GET  /health
 */

/// <reference types="bun-types" />
export {}

const PORT = 3056
const inbox: Array<{ phone: string; code: string; at: string }> = []

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname === '/send') {
      const body = await req.json().catch(() => null)
      if (!body || typeof body.phone !== 'string' || typeof body.code !== 'string') {
        return Response.json({ ok: false, error: 'bad payload' }, { status: 400 })
      }
      inbox.push({
        phone: body.phone,
        code: body.code,
        at: new Date().toISOString(),
      })
      console.log(`[sms-test] SMS received → ${body.phone.slice(0, 4)}*** code stored`)
      return Response.json({ ok: true, messageId: `test-${inbox.length}` })
    }

    if (req.method === 'GET' && url.pathname === '/messages') {
      return Response.json({ ok: true, count: inbox.length, messages: inbox })
    }

    if (req.method === 'POST' && url.pathname === '/reset') {
      inbox.length = 0
      return Response.json({ ok: true })
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, count: inbox.length })
    }

    return Response.json({ ok: false, error: 'not found' }, { status: 404 })
  },
})

console.log(`[sms-test] listening on :${PORT}`)
