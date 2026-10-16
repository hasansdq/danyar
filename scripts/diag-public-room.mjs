/** تشخیص سریع: چرا اتاق معلم از URL عمومی وصل نمی‌شود؟ (فقط url/iceServers — نه توکن) */
import { chromium } from 'file:///home/z/.npm-global/lib/node_modules/playwright/index.mjs'
const BASE = process.env.PREVIEW_BASE ?? 'https://preview-chat-fed40f16-c4fc-4c14-ac39-39439644bc6b.space-z.ai'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(page, u, p) {
  for (let a = 0; a < 3; a++) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(900)
      await page.fill('#username', u); await page.fill('#password', p)
      const robot = page.locator('#notRobot, [role="checkbox"]').first()
      for (let i = 0; i < 12; i++) { try { if ((await robot.getAttribute('aria-checked')) !== 'true') await robot.click(); else break } catch { await robot.click().catch(() => {}) }; await sleep(400) }
      await page.click('button[type="submit"]')
      for (let i = 0; i < 40; i++) { if (!page.url().includes('/login')) return; await sleep(500) }
    } catch { await sleep(2000) }
  }
  throw new Error('login failed')
}

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await ctx.newPage()
  const consoleMsgs = []
  page.on('console', (m) => { const t = m.text(); if (/websocket|ice|signal|mixed|timed out|connect|error/i.test(t)) consoleMsgs.push(t.slice(0, 220)) })
  page.on('pageerror', (e) => consoleMsgs.push('PAGEERROR: ' + e.message.slice(0, 220)))
  await login(page, 'beheshti.t1', 'Pass@123')

  // توکن: فقط فیلدهای url و iceServers (بدون توکن)
  const tok = await page.evaluate(async () => {
    const r = await fetch(`/api/live-sessions/current-token`, { method: 'POST' }).catch(() => null)
    return null
  }).catch(() => null)

  let created = await (await page.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'تشخیص' } })).json().catch(() => null)
  if (created?.reused) { await page.request.post(`${BASE}/api/live-sessions/${created.id}/end`); await sleep(1500); created = await (await page.request.post(`${BASE}/api/live-sessions`, { data: { classroomId: 'cmv1aryqw000alokrajw9ermw', notifyGroupId: 'cmv1aryqy000elokrx43nz39n', title: 'تشخیص' } })).json().catch(() => null) }
  const sid = created?.session?.id ?? created?.id
  console.log('session:', sid)
  const tk = await (await page.request.post(`${BASE}/api/live-sessions/${sid}/token`)).json().catch(() => null)
  console.log('token.url =', tk?.url)
  console.log('token.iceServers =', JSON.stringify(tk?.iceServers ?? null))

  // باز کردن اتاق و ردیابی WS + PC
  await ctx.addInitScript(() => {
    const Orig = window.RTCPeerConnection
    window.__pcs = []
    window.__remoteCands = []
    window.__sdps = []
    window.RTCPeerConnection = function (...args) {
      const pc = new Orig(...args)
      window.__pcs.push(pc)
      const origAdd = pc.addIceCandidate.bind(pc)
      pc.addIceCandidate = async (c, ...rest) => {
        try { window.__remoteCands.push((c && (c.candidate || c.toJSON?.().candidate)) || JSON.stringify(c)) } catch {}
        return origAdd(c, ...rest)
      }
      const origSrd = pc.setRemoteDescription.bind(pc)
      pc.setRemoteDescription = async (d, ...rest) => {
        const r = await origSrd(d, ...rest)
        try { window.__sdps.push(pc.remoteDescription?.sdp ?? '') } catch {}
        return r
      }
      return pc
    }
    window.RTCPeerConnection.prototype = Orig.prototype
    const OWs = window.WebSocket
    window.__wsUrls = []
    window.WebSocket = function (u, ...rest) { window.__wsUrls.push(String(u)); return new OWs(u, ...rest) }
    window.WebSocket.prototype = OWs.prototype
    Object.defineProperty(window.WebSocket, 'CONNECTING', { value: 0 })
  })
  await page.goto(`${BASE}/live/${sid}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-tile-self]', { timeout: 60000 })
  for (let i = 0; i < 35; i++) {
    const st = await page.evaluate(async () => {
      const st = {
        room: window.__lkRoom ? window.__lkRoom.state : 'no-room',
        pcs: (window.__pcs || []).map((p) => ({ sig: p.signalingState, ice: p.iceConnectionState, conn: p.connectionState })),
        ws: (window.__wsUrls || []).slice(-2).map((u) => u.split('?')[0]),
        cand: [],
      }
      for (const p of window.__pcs || []) {
        try {
          const stats = await p.getStats()
          stats.forEach((r) => {
            if (r.type === 'local-candidate' || r.type === 'remote-candidate')
              st.cand.push(`${r.type.split('-')[0]}:${r.protocol || '?'} ${r.address || r.ip}:${r.port}(${r.candidateType})`)
          })
        } catch {}
      }
      return st
    })
    if (i % 5 === 0 || st.room === 'connected') console.log(`t=${i}s`, JSON.stringify(st))
    if (st.room === 'connected') break
    await sleep(1000)
  }
  const banner = await page.evaluate(() => document.body.innerText.includes('اتصال رسانه برقرار نشد') || document.body.innerText.includes('تلاش مجدد'))
  console.log('media-error-banner:', banner)
  // شواهد SDP/کاندید
  const sdpDump = await page.evaluate(() => {
    const lines = (window.__sdps || []).join('\n').split('\n').filter((l) => l.includes('a=candidate'))
    return { sdpCandidates: lines, trickle: (window.__remoteCands || []).filter(Boolean) }
  })
  console.log('---- remote SDP a=candidate lines ----')
  for (const l of sdpDump.sdpCandidates) console.log('  ', l.trim())
  console.log('---- trickle remote candidates ----')
  for (const c of sdpDump.trickle.slice(0, 12)) console.log('  ', String(c).slice(0, 140))
  console.log('---- console (relevant) ----')
  for (const m of consoleMsgs.slice(0, 12)) console.log('  ', m)
  await page.request.post(`${BASE}/api/live-sessions/${sid}/end`).catch(() => {})
} catch (e) { console.log('DIAG FAIL:', e.message) } finally { await browser.close() }
