// دیباگ ورود داخل iframe پیش‌نمایش + رگرسیون ورود مستقیم
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'http://localhost:81'
mkdirSync('/tmp/preview-host', { recursive: true })
writeFileSync('/tmp/preview-host/index.html', `<!doctype html><html><body style="margin:0"><iframe id="pv" src="${BASE}/login" style="border:0;width:100vw;height:100vh"></iframe></body></html>`)
const server = spawn('python3', ['-m', 'http.server', '8899', '--bind', '127.0.0.1', '--directory', '/tmp/preview-host'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1000))

const browser = await chromium.launch()

// --- بخش ۱: رگرسیون ورود مستقیم (بدون iframe) ---
const p1 = await browser.newPage()
let directStatus = 0
p1.on('response', r => { if (r.url().includes('/api/auth')) directStatus = r.status() })
await p1.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await p1.locator('input[name="username"]').fill('superadmin')
await p1.locator('input[name="password"]').fill('Admin@1234')
await p1.locator('[role="checkbox"]').first().click()
await p1.locator('button[type="submit"]').first().click()
await p1.waitForURL('**/admin**', { timeout: 30000 }).catch(() => {})
console.log(`direct-login: url=${p1.url()} api=${directStatus} ${p1.url().includes('/admin') ? '✅' : '❌'}`)
await p1.close()

// --- بخش ۲: ورود داخل iframe با ردیابی پاسخ‌ها ---
const page = await browser.newPage()
const events = []
page.on('response', r => { if (/\/api\//.test(r.url())) events.push(`${r.status()} ${r.url().replace(BASE, '')}`) })
page.on('console', m => { if (/error|warn/i.test(m.type())) events.push(`console[${m.type()}]: ${m.text().slice(0, 120)}`) })
await page.goto('http://127.0.0.1:8899/', { waitUntil: 'domcontentloaded' })
const frame = page.frameLocator('#pv')
await frame.locator('input[name="username"]').first().fill('superadmin', { timeout: 30000 })
await frame.locator('input[name="password"]').first().fill('Admin@1234')
await frame.locator('[role="checkbox"]').first().click()
await frame.locator('button[type="submit"]').first().click()

let iframeOk = false
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000)
  const fu = page.frames().find(f => f !== page.mainFrame())?.url() || ''
  if (fu.includes('/admin')) { iframeOk = true; console.log(`iframe-login: navigated after ${i + 1}s ✅ (${fu})`); break }
}
if (!iframeOk) {
  const fu = page.frames().find(f => f !== page.mainFrame())?.url() || '(none)'
  console.log(`iframe-login: STILL ${fu} ❌`)
  console.log('--- api/console events ---')
  events.slice(-15).forEach(e => console.log(' ', e))
}
await browser.close()
server.kill()
