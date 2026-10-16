// ─────────────────────────────────────────────────────────────────────────────
// rtc-path-isolate.mjs — کدام لایه مسیر /rtc/v1 را می‌بلعد؟ (لایوکیت محلی/گیت‌وی/لبه)
// اجرا: node scripts/rtc-path-isolate.mjs
// ─────────────────────────────────────────────────────────────────────────────
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';

const tok = JSON.parse(readFileSync('/tmp/lasttok.json', 'utf8'));
const PREVIEW = 'wss://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai';

function probe(name, url, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 9000, headers });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); try { ws.close(); } catch {} } };
    const t1 = setTimeout(() => done('TIMEOUT (open نشد)'), 9500);
    ws.on('open', () => {
      clearTimeout(t1);
      const t2 = setTimeout(() => done('OPEN silent — هیچ پیام/بستنی نیامد (۳ثانیه)'), 5000);
      ws.on('message', (d) => { clearTimeout(t2); done(`MSG ✔ (${d.length} بایت — پیام پروتکل)`); });
      ws.on('close', (c) => { if (!settled) { clearTimeout(t2); done(`CLOSED code=${c}`); } });
    });
    ws.on('unexpected-response', (_q, res) => { clearTimeout(t1); done(`HTTP ${res.statusCode}`); });
    ws.on('error', (e) => { clearTimeout(t1); done('ERR ' + String(e.message).slice(0, 60)); });
  });
}

const q = (path, xform) => `${path}?access_token=${encodeURIComponent(tok.token)}&auto_subscribe=0${xform ? '&XTransformPort=7880' : ''}`;

const tests = [
  ['۱) مستقیم :7880 /rtc/v1', 'ws://127.0.0.1:7880' + q('/rtc/v1', false)],
  ['۲) مستقیم :7880 /rtc', 'ws://127.0.0.1:7880' + q('/rtc', false)],
  ['۳) گیت‌وی :81 /rtc/v1 + transform', 'ws://127.0.0.1:81' + q('/rtc/v1', true)],
  ['۴) گیت‌وی :81 /rtc/v1 بدون transform', 'ws://127.0.0.1:81' + q('/rtc/v1', false)],
  ['۵) گیت‌وی :81 /rtc + transform', 'ws://127.0.0.1:81' + q('/rtc', true)],
  ['۶) لبهٔ بیرونی /rtc/v1 + transform', PREVIEW + q('/rtc/v1', true)],
  ['۷) لبهٔ بیرونی /rtc/v1 بدون transform', PREVIEW + q('/rtc/v1', false)],
  ['۸) لبهٔ بیرونی /rtc + transform', PREVIEW + q('/rtc', true)],
];

for (const [name, url] of tests) {
  console.log(`${(await probe(name, url))} — ${name}`);
}
