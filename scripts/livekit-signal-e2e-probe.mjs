// ─────────────────────────────────────────────────────────────────────────────
// livekit-signal-e2e-probe.mjs — بازسازی دقیق مسیر سیگنال لایوکیت از مرورگر
// لاگین → engine.io خام (با XTransformPort=3003 مثل مرورگر) → live:join → توکن
// → WS با توکن واقعی به ۴ واریانت URL — انتظار پیام پروتکل (join) نه فقط آپگرید
// اجرا: node scripts/livekit-signal-e2e-probe.mjs
// ─────────────────────────────────────────────────────────────────────────────
import WebSocket from 'ws';
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai';
const saved = JSON.parse(readFileSync('/tmp/probe-token.json', 'utf8'));
const SOCK_Q = 'XTransformPort=3003'; // پارامتر اضافه در کوئری /socket.io/ — عین probe کارا
let t = Date.now().toString(36);
const sockUrl = (extra) => `${BASE}/socket.io/?EIO=4&transport=polling&t=${t++}&${SOCK_Q}${extra}`;

// ─── ۱) لاگین ───
let r = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'beheshti.t1', password: 'Pass@123', realm: 'app' }),
});
const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
console.log('login:', r.status);
const H = { cookie, 'content-type': 'text/plain;charset=UTF-8' };

// ─── ۱-ب) جلسهٔ تازه (جلسهٔ قبلی ممکن است پایان یافته باشد) ───
r = await fetch(BASE + '/api/live-sessions', {
  method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ classroomId: saved.classroomId, notifyGroupId: saved.notifyGroupId, title: 'probe-signal' }),
});
const sess = await r.json();
const SESSION_ID = sess.session?.id ?? sess.id ?? saved.id;
console.log('create session:', r.status, SESSION_ID.slice(0, 10) + '…');

// ─── ۲) engine.io خام: handshake → CONNECT → live:join ───
r = await fetch(sockUrl(''), { headers: { cookie } });
const hs = await r.text();
const sid = JSON.parse(hs.replace(/^\d+/, '')).sid;
console.log('handshake: sid=', sid.slice(0, 8) + '…');
r = await fetch(sockUrl(`&sid=${sid}`), { method: 'POST', headers: H, body: '40' });
console.log('CONNECT:', r.status);
await new Promise((res) => setTimeout(res, 700));
r = await fetch(sockUrl(`&sid=${sid}`), { headers: { cookie } }); // درینِ CONNECT ack
await r.text();
// emit live:join — بستهٔ پیام socket.io: 42["live:join",{...}]
r = await fetch(sockUrl(`&sid=${sid}`), {
  method: 'POST', headers: H,
  body: '42' + JSON.stringify(['live:join', { sessionId: SESSION_ID }]),
});
console.log('live:join emit:', r.status);
await new Promise((res) => setTimeout(res, 900));
r = await fetch(sockUrl(`&sid=${sid}`), { headers: { cookie } });
const drain = await r.text();
console.log('join ack:', drain.replace(/\d+\[/g, '[').slice(0, 140));

// ─── ۳) توکن واقعی — با هدر Origin مثل مرورگر ───
r = await fetch(`${BASE}/api/live-sessions/${SESSION_ID}/token`, {
  method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: BASE, Referer: BASE + '/live', 'sec-fetch-site': 'same-origin' }, body: '{}',
});
const tok = await r.json();
console.log('token:', r.status, '| url:', tok.url);
if (r.status !== 200 || !tok.token) process.exit(1);

// ─── ۴) واریانت‌های URL — دقیقاً مثل createV0RtcUrl لایوکیت‌کلاینت v2 ───
const base = new URL(tok.url.replace(/^ws/, 'http'));
const q = new URLSearchParams(base.search);
const mk = (path, keepTransform) => {
  const u = new URL(`https://${base.host}${path}`);
  if (keepTransform) for (const [k, v] of q) u.searchParams.set(k, v);
  u.searchParams.set('access_token', tok.token);
  u.searchParams.set('auto_subscribe', '0');
  return 'wss://' + u.host + u.pathname + '?' + u.searchParams.toString();
};
const variants = [
  ['A) rtc/v1 + XTransformPort=7880 (عین کلاینت)', mk('/rtc/v1', true)],
  ['B) rtc/v1 بدون transform', mk('/rtc/v1', false)],
  ['C) rtc v0 + XTransformPort=7880', mk('/rtc', true)],
];

function probe(name, url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { handshakeTimeout: 10000 });
    let firstMsg = null, settled = false;
    const done = (v, msg) => { if (!settled) { settled = true; resolve({ v, msg }); try { ws.close(); } catch {} } };
    const to1 = setTimeout(() => done('✘ TIMEOUT (حتی open نشد)'), 11000);
    ws.on('open', () => {
      clearTimeout(to1);
      const to2 = setTimeout(() => done('✘ OPEN اما هیچ پیام پروتکل نیامد — تایم‌اوت سیگنال (عین خطای مرورگر)'), 8000);
      ws.on('message', (d) => { if (!firstMsg) { firstMsg = d.toString(); clearTimeout(to2); done('✔ پیام پروتکل رسید', firstMsg.slice(0, 90)); } });
      ws.on('close', (c, rs) => { if (!firstMsg) { clearTimeout(to2); done(`✘ بسته شد بدون پیام: code=${c} ${String(rs).slice(0, 50)}`); } });
    });
    ws.on('unexpected-response', (_q, res) => { clearTimeout(to1); done(`✘ HTTP ${res.statusCode}`); });
    ws.on('error', (e) => { clearTimeout(to1); done('✘ ERROR: ' + String(e.message).slice(0, 70)); });
  });
}

for (const [name, url] of variants) {
  const { v, msg } = await probe(name, url);
  console.log(`${v} ${name}${msg ? ' — ' + msg : ''}`);
}

// ─── ۵) ذخیره توکن برای آزمون مقایسه‌ای جداگانه ───
{ writeFileSync("/tmp/lasttok.json", JSON.stringify(tok)); }
