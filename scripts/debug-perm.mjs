import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:3034'
const browser = await chromium.launch()
const ctx = await browser.newContext()
await ctx.grantPermissions(['notifications'], { origin: BASE })
const page = await ctx.newPage()
await page.goto(BASE + '/login')
console.log('Notification.permission:', await page.evaluate(() => Notification.permission))
console.log('PushManager?', await page.evaluate(() => 'PushManager' in window))
console.log('SW?', await page.evaluate(() => 'serviceWorker' in navigator))
await browser.close()
process.exit(0)
