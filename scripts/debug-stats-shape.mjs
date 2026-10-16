/** فورس relay روی PC خام — چه نوع رکوردهای stats گزارش می‌شود؟ (فقط type ها، بدون مقدار) */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'

const browser = await chromium.launch()
const page = await browser.newPage()
const out = await page.evaluate(async () => {
  const pc = new RTCPeerConnection({ iceServers: [] })
  pc.createDataChannel('probe')
  await pc.setLocalDescription(await pc.createOffer())
  await new Promise((r) => setTimeout(r, 2500))
  const stats = await pc.getStats()
  const types = {}
  let pairShape = null
  stats.forEach((r) => {
    types[r.type] = (types[r.type] ?? 0) + 1
    if (r.type === 'candidate-pair' && !pairShape) {
      pairShape = { state: r.state, nominated: r.nominated, selected: r.selected, hasLocalId: !!r.localCandidateId, hasRemoteId: !!r.remoteCandidateId }
    }
  })
  return { ua: navigator.userAgent.includes('Chrome/') ? navigator.userAgent.match(/Chrome\/[\d.]+/)[0] : navigator.userAgent, types, pairShape }
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
