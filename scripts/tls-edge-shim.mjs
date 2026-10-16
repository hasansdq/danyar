/**
 * شبه‌ساز لبه TLS محلی — بازسازی دقیق محیط کاربرِ پیش‌نمایش
 *
 * چرا: کاربر برنامه را روی https://preview-….space-z.ai می‌بیند؛ لبه، TLS را خاتمه می‌دهد
 * و HTTP ساده به درگاه :81 می‌دهد. این اسکریپت همان لبه را روی 8443 محلی می‌سازد:
 *   مرورگر (https://c-6acd8a54-…:8443) → این لبه (TLS) → درگاه :81 → برنامه/LiveKit
 * هدرها دست‌نخورده عبور می‌کنند (بدون افزودن X-Forwarded-Proto) تا رفتار واقعی زنجیره
 * حفظ شود — یعنی Next همان‌طور که برای کاربر پیش می‌آید «http» می‌بیند.
 *
 * WebSocket: رویداد upgrade → تونل خام TCP به :81 (مثل لبه واقعی که 101 پاس می‌دهد)
 */
import https from 'node:https'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'

const CERT = fs.readFileSync('/home/z/my-project/.tools/tls/cert.pem')
const KEY = fs.readFileSync('/home/z/my-project/.tools/tls/key.pem')
const UP_HOST = '127.0.0.1'
const UP_PORT = 81

const HOP = new Set(['connection', 'upgrade', 'keep-alive', 'proxy-connection', 'transfer-encoding'])

function cleanHeaders(req) {
  const h = { ...req.headers }
  for (const k of Object.keys(h)) if (HOP.has(k.toLowerCase())) delete h[k]
  return h
}

const server = https.createServer({ cert: CERT, key: KEY }, (req, res) => {
  const upstream = http.request(
    {
      host: UP_HOST,
      port: UP_PORT,
      method: req.method,
      path: req.url,
      headers: cleanHeaders(req),
      agent: new http.Agent({ keepAlive: false }),
    },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers)
      ur.pipe(res)
    },
  )
  upstream.on('error', (e) => {
    try {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`edge-shim upstream error: ${e.message}`)
    } catch {}
  })
  req.pipe(upstream)
})

// تونل WebSocket خام — دقیقاً بایت‌به‌بایت مثل یک لبه شفاف
server.on('upgrade', (req, clientSocket, head) => {
  const upstream = net.connect(UP_PORT, UP_HOST, () => {
    const raw = [
      `${req.method} ${req.url} HTTP/1.1`,
      ...Object.entries(cleanHeaders(req)).map(([k, v]) => `${k}: ${v}`),
      'Connection: Upgrade',
      `Upgrade: ${req.headers.upgrade ?? 'websocket'}`,
      '\r\n',
    ].join('\r\n')
    upstream.write(raw)
    if (head?.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  upstream.on('error', () => clientSocket.destroy())
  clientSocket.on('error', () => upstream.destroy())
})

server.listen(8443, '127.0.0.1', () => console.log('TLS edge shim on https://127.0.0.1:8443 → :81'))
