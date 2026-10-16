/**
 * سرویس آزمون پوش — شبیه‌ساز سرویس Web Push مرورگر (FCM/Mozilla).
 * - هر POST /push/<tag> یک ارسال واقعی web-push (کدگذاری‌شده با VAPID) ثبت می‌کند
 * - رفتار خطا بر اساس نام tag: شامل «404» / «410» / «retry» (اول ۴۲۹ بعد موفق) / «500»
 * - اگر کلیدهای آزمون ثبت شود، payload رمزنگاری‌شده aes128gcm رمزگشایی و
 *   در پاسخ بازگردانده می‌شود تا حریم خصوصی محتوای اعلان قابل تأیید باشد.
 */

/// <reference types="bun-types" />
export {}

const PORT = Number(process.env.PORT ?? 3057)

interface Rec {
  tag: string
  at: string
  status: number // وضعیتی که سرویس به web-push برمی‌گرداند
  contentEncoding: string
  authHeader: string | null
  bodyB64: string
  payload: string | null // رمزگشایی‌شده (اگر کلیدها ثبت شده باشند)
  decryptError?: string
}

const records = new Map<string, Rec[]>()
const retryCount = new Map<string, number>()
let keys: { privateJwk: JsonWebKey; auth: string } | null = null

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function b64urlToBuf(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.replace(/=+$/, '')
  const bytes: number[] = []
  let bits = 0
  let acc = 0
  for (const ch of clean) {
    const v = B64URL.indexOf(ch)
    if (v < 0) throw new Error('bad base64url')
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}
function bufToB64url(b: Uint8Array): string {
  let out = ''
  let bits = 0
  let acc = 0
  for (const byte of b) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 6) {
      bits -= 6
      out += B64URL[(acc >> bits) & 63]
    }
  }
  if (bits > 0) out += B64URL[(acc << (6 - bits)) & 63]
  return out
}

/** رمزگشایی payload aes128gcm طبق RFC 8291 (کلید گیرنده خودمان است) */
async function decryptAes128gcm(body: Uint8Array): Promise<string> {
  if (!keys) throw new Error('KEYS_NOT_REGISTERED')
  if (body.length < 21) throw new Error('BODY_TOO_SHORT')
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0)
  const idlen = body[20]
  const senderPub = body.slice(21, 21 + idlen) // کلید عمومی موقت فرستنده (65 بایت)
  const ct = body.slice(21 + idlen)

  const privKey = await crypto.subtle.importKey(
    'jwk',
    keys.privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  // ساخت کلید عمومی گیرنده از x/y JWK
  const x = b64urlToBuf(keys.privateJwk.x as string)
  const y = b64urlToBuf(keys.privateJwk.y as string)
  const receiverPub = new Uint8Array(65)
  receiverPub[0] = 0x04
  receiverPub.set(x, 1)
  receiverPub.set(y, 33)

  // ۱) راز ECDH
  const senderKey = await crypto.subtle.importKey(
    'raw',
    senderPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, privKey, 256),
  )

  // ۲) secret = HKDF(salt=authSecret, ikm=ECDH, info="WebPush: info\0"||receiver||sender, 32)
  const webpushInfo = new Uint8Array(14 + 65 + 65)
  webpushInfo.set(new TextEncoder().encode('WebPush: info'), 0)
  webpushInfo.set([0x00], 13)
  webpushInfo.set(receiverPub, 14)
  webpushInfo.set(senderPub, 79)
  const authSecret = b64urlToBuf(keys.auth)
  const ikm1 = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: webpushInfo },
      ikm1,
      256,
    ),
  )

  // ۳) CEK/NONCE = HKDF کامل دوم با salt هدر — معادل Extract(salt,secret)+Expand
  const ikm2 = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  const cek = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
      },
      ikm2,
      128,
    ),
  )
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt,
        info: new TextEncoder().encode('Content-Encoding: nonce\0'),
      },
      ikm2,
      96,
    ),
  )

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  // نکته: http_ece (کتابخانه web-push) هنگام رمزکردن aes128gcm هیچ AAD تنظیم نمی‌کند؛
  // رمزگشایی هم باید بدون additionalData انجام شود تا با خروجی واقعی سازگار باشد.
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      tagLength: 128,
    },
    aesKey,
    ct,
  )
  // حذف پدینگ: آخرین بایت ۰x02/۰x00 جداکننده است
  const bytes = new Uint8Array(pt)
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0x00) end--
  if (end > 0 && bytes[end - 1] === 0x02) end--
  else if (end > 0 && bytes[end - 1] === 0x01) end--
  return new TextDecoder().decode(bytes.slice(0, end))
}

async function tryDecrypt(r: Rec): Promise<void> {
  try {
    r.payload = await decryptAes128gcm(b64urlToBuf(r.bodyB64))
  } catch (e) {
    r.payload = null
    r.decryptError = e instanceof Error ? e.message : 'DECRYPT_FAILED'
  }
}

Bun.serve({
  port: PORT,
  idleTimeout: 30,
  // HTTPS خودامضا برای سازگاری با web-push (فقط https را می‌فهمد)
  tls: {
    key: Bun.file(new URL('./test-certs/push-test-key.pem', 'file:///home/z/my-project/scripts/')),
    cert: Bun.file(new URL('./test-certs/push-test-cert.pem', 'file:///home/z/my-project/scripts/')),
  },
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === 'POST' && path.startsWith('/push/')) {
      const tag = decodeURIComponent(path.slice('/push/'.length))
      // رفتار خطا بر اساس tag
      let status = 201
      if (tag.includes('-e404')) status = 404
      else if (tag.includes('-e410')) status = 410
      else if (tag.includes('-e500')) status = 500
      else if (tag.includes('-eretry')) {
        const n = (retryCount.get(tag) ?? 0) + 1
        retryCount.set(tag, n)
        if (n === 1) status = 429
      }

      const body = new Uint8Array(await req.arrayBuffer())
      const rec: Rec = {
        tag,
        at: new Date().toISOString(),
        status,
        contentEncoding: req.headers.get('content-encoding') ?? '',
        authHeader: req.headers.get('authorization') ? 'PRESENT' : null,
        bodyB64: bufToB64url(body),
        payload: null,
      }
      await tryDecrypt(rec)
      const list = records.get(tag) ?? []
      list.push(rec)
      records.set(tag, list)

      return new Response(JSON.stringify({ ok: status < 300 }), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (req.method === 'GET' && path === '/records') {
      const tag = url.searchParams.get('tag')
      const out: Rec[] = []
      for (const [t, list] of records) {
        if (tag && t !== tag) continue
        out.push(...list)
      }
      out.sort((a, b) => a.at.localeCompare(b.at))
      return Response.json({ records: out, keysRegistered: !!keys })
    }

    if (req.method === 'POST' && path === '/register-keys') {
      const d = (await req.json()) as { privateJwk: JsonWebKey; auth: string }
      keys = { privateJwk: d.privateJwk, auth: d.auth }
      // رمزگشایی مجدد رکوردهای قبلی
      for (const list of records.values()) for (const r of list) await tryDecrypt(r)
      return Response.json({ ok: true })
    }

    if (req.method === 'POST' && path === '/reset') {
      records.clear()
      retryCount.clear()
      keys = null
      return Response.json({ ok: true })
    }

    if (req.method === 'GET' && path === '/health') return Response.json({ ok: true })

    return new Response('not found', { status: 404 })
  },
})

console.log(`✔ push-test-server on http://127.0.0.1:${PORT}`)
