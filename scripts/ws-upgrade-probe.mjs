// ─────────────────────────────────────────────────────────────────────────────
// ws-upgrade-probe.mjs — ریشه‌یابی تایم‌اوت سیگنال لایوکیت از مسیر پیش‌نمایش
// سه سؤال:
//   ۱) WS آپگرید به /rtc از گیت‌وی داخلی :81 پاس می‌شود؟ (انتظار: بله)
//   ۲) WS آپگرید به /rtc از دامنه بیرونی پیش‌نمایش پاس می‌شود؟ (شک: تایم‌اوت/۴۰۳)
//   ۳) WS آپگرید به /socket.io از هر دو مسیر چطور؟ (مقایسه برای تفکیک مقصر)
// اجرا: node scripts/ws-upgrade-probe.mjs
// ─────────────────────────────────────────────────────────────────────────────
import WebSocket from 'ws';

const PREVIEW = 'wss://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai';
const GW81 = 'ws://127.0.0.1:81';

function probe(name, url, extraHeaders = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const to = setTimeout(() => done({ name, url, result: 'TIMEOUT', ms: Date.now() - t0 }), timeoutMs);
    try {
      const ws = new WebSocket(url, { headers: extraHeaders, handshakeTimeout: timeoutMs });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(to);
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => done({ name, url, result: `HTTP ${res.statusCode}`, ms: Date.now() - t0, body: body.slice(0, 120) }));
      });
      ws.on('open', () => { clearTimeout(to); ws.close(); done({ name, url, result: 'WS 101 OK', ms: Date.now() - t0 }); });
      ws.on('error', (e) => { clearTimeout(to); done({ name, url, result: `ERROR: ${e.message?.slice(0, 90)}`, ms: Date.now() - t0 }); });
    } catch (e) { clearTimeout(to); done({ name, url, result: `THROW: ${e.message?.slice(0, 90)}` }); }
  });
}

const rtcQ = '/rtc?access_token=probe&auto_subscribe=0';
const sockQ = '/socket.io/?EIO=4&transport=websocket';
const Origin = 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai';

const tests = [
  ['داخلی :81 → /rtc', GW81 + rtcQ, { Host: 'preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai', Origin }],
  ['بیرونی preview → /rtc', PREVIEW + rtcQ, { Origin }],
  ['داخلی :81 → /socket.io WS', GW81 + sockQ, {}],
  ['بیرونی preview → /socket.io WS', PREVIEW + sockQ, {}],
];

for (const [name, url, headers] of tests) {
  const r = await probe(name, url, headers);
  console.log(`${r.result === 'WS 101 OK' ? '✔' : '✘'} ${name}: ${r.result} (${r.ms}ms)${r.body ? ' — ' + r.body : ''}`);
}
console.log('\nتفسیر: اگر /rtc داخلی سبز و بیرونی قرمز باشد → مقصر پروکسی بیرونی پیش‌نمایش است (آپگرید WS رد می‌شود).');
console.log('اگر هر دو /rtc قرمز باشند → مشکل روتینگ گیت‌وی داخلی است.');
