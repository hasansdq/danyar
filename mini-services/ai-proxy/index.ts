/**
 * پروکسی محلی دستیار دانیار — پل OpenAI-سازگار به سرویس داخلی Z.AI.
 * فقط برای «راستی‌آزمایی سندباکس»: برنامه با provider=openai به همین پروکسی وصل می‌شود؛
 * پروکسی هدرهای احراز هویت سرویس داخلی را می‌افزاید و پاسخ را (استریمی) برمی‌گرداند.
 * در استقرار واقعی، کلید و سرویس‌دهندهٔ خودتان را از پنل مدیر کل تنظیم می‌کنید.
 */
import { readFileSync } from 'fs'

const PORT = 3021
const UPSTREAM = 'https://internal-api.z.ai/v1'

type ZaiConfig = { baseUrl: string; apiKey: string; chatId?: string; userId?: string; token?: string }

function loadConfig(): ZaiConfig {
  for (const p of ['/etc/.z-ai-config', `${process.env.HOME ?? ''}/.z-ai-config`]) {
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf-8'))
      if (cfg.baseUrl && cfg.apiKey) return cfg
    } catch {
      /* بگرد بعدی */
    }
  }
  throw new Error('.z-ai-config یافت نشد')
}

const cfg = loadConfig()

function upstreamHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  }
  if (cfg.chatId) h['X-Chat-Id'] = cfg.chatId
  if (cfg.userId) h['X-User-Id'] = cfg.userId
  if (cfg.token) h['X-Token'] = cfg.token
  return h
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === 'POST' && url.pathname.endsWith('/chat/completions')) {
      const body = await req.text()
      const res = await fetch(`${UPSTREAM}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...upstreamHeaders() },
        body,
      })
      // پاسخ استریمی عیناً بازگردانده می‌شود (SSE بدون بافر)
      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': res.headers.get('content-type') ?? 'application/json',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      })
    }

    return Response.json({ error: 'only POST /v1/chat/completions is proxied' }, { status: 404 })
  },
})

console.log(`[ai-proxy] listening on :${PORT} → ${UPSTREAM} (streaming passthrough)`)
