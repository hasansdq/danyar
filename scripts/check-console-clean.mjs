/** بررسی بارگذاری صفحه اصلی بدون خطای runtime (ارور clipboard-list کاربر) */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const BASE = process.env.TEST_BASE || 'http://localhost:81'

async function main() {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error' && /module factory|not available|HMR/i.test(m.text())) errors.push(m.text())
  })

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(4000)
  const rootText = (await page.locator('body').innerText().catch(() => '')).slice(0, 200)
  console.log('ROOT_TEXT:', rootText.replace(/\n/g, ' | ').slice(0, 160))

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(3000)
  const loginText = (await page.locator('body').innerText().catch(() => '')).slice(0, 200)
  console.log('LOGIN_TEXT:', loginText.replace(/\n/g, ' | ').slice(0, 160))

  if (errors.length) {
    console.log('PAGE_ERRORS(' + errors.length + '):')
    for (const e of errors.slice(0, 5)) console.log('  -', e.slice(0, 300))
    console.log('RESULT: FAIL')
    process.exitCode = 1
  } else {
    console.log('RESULT: PASS — no runtime module errors')
  }
  await browser.close()
}

main().catch((e) => { console.error('CRASH:', e); process.exit(1) })
