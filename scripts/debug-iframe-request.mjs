// ردیابی بدنه درخواست ورود داخل iframe — چرا 400؟
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'http://localhost:81'
mkdirSync('/tmp/preview-host', { recursive: true })
writeFileSync('/tmp/preview-host/index.html', `<!doctype html><html><body style="margin:0"><iframe id="pv" src="${BASE}/superadmin" style="border:0;width:100vw;height:100vh"></iframe></body></html>`)
const server = spawn('python3', ['-m', 'http.server', '8899', '--bind', '127.0.0.1', '--directory', '/tmp/preview-host'], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 1000))

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('request', r => {
  if (r.url().includes('/api/auth/login')) console.log('REQ:', r.method(), 'body=', (r.postData() || '(empty)').slice(0, 200))
})
page.on('response', r => { if (r.url().includes('/api/auth/login')) console.log('RES:', r.status()) })
page.on('console', m => { if (m.type() === 'error') console.log('console-error:', m.text().slice(0, 140)) })

await page.goto('http://127.0.0.1:8899/', { waitUntil: 'domcontentloaded' })
const frame = page.frameLocator('#pv')
await frame.locator('input[name="username"]').first().waitFor({ state: 'visible', timeout: 30000 })
console.log('frame url:', page.frames().find(f => f !== page.mainFrame())?.url())

const u = frame.locator('input[name="username"]').first()
await u.fill('superadmin')
console.log('username value in iframe:', await u.inputValue())
await frame.locator('input[name="password"]').first().fill('Admin@1234')
await frame.locator('[role="checkbox"]').first().click()
await page.waitForTimeout(500)
await frame.locator('button[type="submit"]').first().click()

for (let i = 0; i < 25; i++) {
  await page.waitForTimeout(1000)
  const fu = page.frames().find(f => f !== page.mainFrame())?.url() || ''
  if (fu.includes('/admin')) { console.log(`✅ navigated after ${i + 1}s -> ${fu}`); break }
  if (i === 24) console.log('❌ still:', fu)
}
await page.screenshot({ path: '/home/z/my-project/download/138-iframe-superadmin-debug.png' })
await browser.close()
server.kill()
