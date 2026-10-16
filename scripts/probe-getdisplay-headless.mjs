/**
 * پروب: getDisplayMedia روی صفحهٔ واقعی اپ (localhost = secure context)
 */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--auto-select-desktop-capture-source=Entire screen',
  ],
})
const page = await browser.newPage()
await page.goto('http://localhost:81/login', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const result = await page.evaluate(async () => {
  try {
    if (!navigator.mediaDevices) return { ok: false, error: 'no mediaDevices' }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const tracks = stream.getVideoTracks()
    const info = tracks.map((t) => ({
      label: t.label,
      readyState: t.readyState,
      w: t.getSettings().width,
      h: t.getSettings().height,
    }))
    stream.getTracks().forEach((t) => t.stop())
    return { ok: true, count: tracks.length, info }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})
console.log(JSON.stringify(result, null, 1))
await browser.close()
