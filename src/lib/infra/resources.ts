import fsSync from 'fs'
import os from 'os'
import path from 'path'
import { resourcesScopeLabel } from './run-mode'
import type {
  AlertState,
  CpuInfo,
  DiskInfo,
  InfraThresholds,
  MemoryInfo,
  NetworkInfo,
  ResourceSample,
  ResourcesSnapshot,
  ResourceScope,
  UptimeInfo,
} from './types'

/**
 * نمونه‌برداری منابع سرور — فقط از منابع استاندارد و در دسترس:
 * /proc/stat (CPU)، /proc/meminfo + cgroup (حافظه)، fs.statfs (دیسک)،
 * /proc/net/dev (شبکه)، /proc/uptime (uptime).
 *
 * صداقت:
 * - هر چیزی که خوانده نشد «در دسترس نیست» با دلیل — دما/سخت‌افزار حدس زده نمی‌شود
 * - سقف کانتینر (cgroup) از مجموعهٔ میزبان جدا و برچسب‌دار گزارش می‌شود
 * - بدون Docker socket و بدون هیچ فرمانی — فقط خواندن فایل‌های سیستمی
 */

const HISTORY_LIMIT = 120 // ~۱ ساعت با polling ۳۰ ثانیه‌ای

interface HistoryState {
  samples: ResourceSample[]
}

const g = globalThis as unknown as {
  __infraHistory?: HistoryState
  __infraPrevNet?: { at: number; rx: number; tx: number }
}

function history(): HistoryState {
  if (!g.__infraHistory) g.__infraHistory = { samples: [] }
  return g.__infraHistory
}

// ─── CPU ───

interface ProcStat {
  idleTotal: number
  allTotal: number
}

function readProcStat(): ProcStat | null {
  try {
    const line = fsSync.readFileSync('/proc/stat', 'utf8').split('\n')[0] ?? ''
    const parts = line.split(/\s+/).slice(1).map(Number)
    if (parts.length < 5 || parts.some((n) => !Number.isFinite(n))) return null
    // user nice system idle iowait irq softirq steal guest guest_nice
    const [user, nice, sys, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts
    const idleTotal = idle + iowait
    const allTotal = user + nice + sys + idle + iowait + irq + softirq + steal
    return { idleTotal, allTotal }
  } catch {
    return null
  }
}

const CPU_SAMPLE_GAP_MS = 250

async function sampleCpu(): Promise<number | null> {
  const a = readProcStat()
  if (!a) return null
  await new Promise((r) => setTimeout(r, CPU_SAMPLE_GAP_MS))
  const b = readProcStat()
  if (!b) return null
  const total = b.allTotal - a.allTotal
  const idle = b.idleTotal - a.idleTotal
  if (total <= 0) return null
  return clampPercent(((total - idle) / total) * 100)
}

/** سقف CPU کانتینر — cgroup v2 (cpu.max) یا v1 (cpu.cfs_quota_us/period) */
function containerCpuLimit(): number | null {
  try {
    const raw = fsSync.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim()
    // قالب: «max 100000» یا «150000 100000»
    const [quota, period] = raw.split(/\s+/)
    if (quota !== 'max' && period) {
      const cores = Number(quota) / Number(period)
      if (Number.isFinite(cores) && cores > 0) return Math.round(cores * 100) / 100
    }
    return null
  } catch {
    /* v1 یا بدون محدودیت */
  }
  try {
    const quota = Number(fsSync.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'))
    const period = Number(fsSync.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'))
    if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) {
      return Math.round((quota / period) * 100) / 100
    }
    return null
  } catch {
    return null
  }
}

async function readCpu(): Promise<CpuInfo> {
  const scope: ResourceScope = { label: resourcesScopeLabel() }
  const cores = os.cpus()?.length ?? 0
  const [percent, load] = await Promise.all([sampleCpu(), readLoadAvg()])
  return {
    percent,
    cores: cores > 0 ? cores : 0,
    containerCoreLimit: containerCpuLimit(),
    load1: load[0],
    load5: load[1],
    load15: load[2],
    scope,
  }
}

function readLoadAvg(): [number | null, number | null, number | null] {
  try {
    const parts = fsSync.readFileSync('/proc/loadavg', 'utf8').split(/\s+/)
    return [Number(parts[0]) || null, Number(parts[1]) || null, Number(parts[2]) || null]
  } catch {
    const l = os.loadavg()
    return [l[0] || null, l[1] || null, l[2] || null]
  }
}

// ─── حافظه ───

function readContainerMemLimit(): number | null {
  // cgroup v2
  try {
    const raw = fsSync.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim()
    if (raw !== 'max') {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) return n
    }
  } catch {
    /* ادامه به v1 */
  }
  // cgroup v1
  try {
    const n = Number(fsSync.readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8'))
    // مقدار بزرگ نامعقول = بدون محدودیت واقعی
    if (Number.isFinite(n) && n > 0 && n < Number.MAX_SAFE_INTEGER && n !== 0x7ffffffffffff000) {
      return n
    }
  } catch {
    /* بدون cgroup */
  }
  // نشانگر محیط پیش‌نمایش Z.AI (سقف حافظهٔ تابع — MB)
  const fc = Number(process.env.FC_FUNCTION_MEMORY_SIZE ?? '')
  if (Number.isFinite(fc) && fc > 0) return fc * 1024 * 1024
  return null
}

function readMemory(): MemoryInfo {
  const scope: ResourceScope = { label: resourcesScopeLabel() }
  const total = os.totalmem()
  const free = os.freemem()
  const containerLimit = readContainerMemLimit()
  // مصرف مؤثر نسبت به «کوچک‌ترین سقف معتبر» (میزبان یا کانتینر) — بدون قاطی‌کردن دو دامنه
  const effectiveTotal = containerLimit && containerLimit > 0 ? Math.min(total, containerLimit) : total
  // مصرف از دید cgroup در صورت وجود (دقیق‌تر برای کانتینر)
  let used: number | null = total - free
  try {
    const cur = Number(fsSync.readFileSync('/sys/fs/cgroup/memory.current', 'utf8'))
    if (Number.isFinite(cur) && cur >= 0) used = cur
  } catch {
    /* fallback به os */
  }
  const rss = process.memoryUsage().rss
  return {
    usedPercent: used !== null && effectiveTotal > 0 ? clampPercent((used / effectiveTotal) * 100) : null,
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    containerLimitBytes: containerLimit,
    processRssBytes: rss,
    scope,
  }
}

// ─── دیسک ───

function statfsBytes(p: string): { totalBytes: number; freeBytes: number } | null {
  try {
    const st = fsSync.statfsSync(p)
    const total = Number(st.blocks) * Number(st.bsize)
    const free = Number(st.bfree) * Number(st.bsize)
    if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return null
    return { totalBytes: total, freeBytes: free }
  } catch {
    return null
  }
}

function dbDirPath(): string {
  const url = process.env.DATABASE_URL ?? ''
  if (/^file:/i.test(url)) {
    const raw = url.slice(5)
    if (raw.startsWith('/')) return path.dirname(path.resolve(raw))
    if (raw.startsWith('./') || raw.startsWith('../'))
      return path.dirname(path.resolve(process.cwd(), raw))
    // نسبی بدون پیشوند — Prisma نسبت به محل schema حل می‌کند
    return path.dirname(path.resolve(process.cwd(), 'prisma', raw))
  }
  return path.join(process.cwd(), 'db')
}

function uploadDirPath(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), 'uploads')
}

function readDisks(): DiskInfo[] {
  const scope: ResourceScope = { label: resourcesScopeLabel() }
  const targets: { label: string; p: string }[] = [
    { label: 'دیتابیس', p: dbDirPath() },
    { label: 'آپلود', p: uploadDirPath() },
  ]
  const out: DiskInfo[] = []
  for (const t of targets) {
    const st = statfsBytes(t.p)
    out.push({
      path: t.p,
      usedPercent: st ? clampPercent(((st.totalBytes - st.freeBytes) / st.totalBytes) * 100) : null,
      totalBytes: st?.totalBytes ?? null,
      freeBytes: st?.freeBytes ?? null,
      scope,
    })
  }
  return out
}

// ─── شبکه ───

interface NetTotals {
  rx: number
  tx: number
}

function readNetDev(): NetTotals | null {
  try {
    const raw = fsSync.readFileSync('/proc/net/dev', 'utf8')
    let rx = 0
    let tx = 0
    for (const line of raw.split('\n').slice(2)) {
      const [iface, data] = line.split(':')
      if (!iface || !data) continue
      const name = iface.trim()
      // رابط‌های مجازی/loopback حساب نمی‌شوند
      if (name === 'lo' || name.startsWith('veth') || name.startsWith('br-') || name.startsWith('docker')) continue
      const cols = data.trim().split(/\s+/).map(Number)
      if (cols.length < 10 || cols.some((n) => !Number.isFinite(n))) continue
      rx += cols[0]
      tx += cols[8]
    }
    return { rx, tx }
  } catch {
    return null
  }
}

async function readNetwork(): Promise<NetworkInfo> {
  const scope: ResourceScope = { label: resourcesScopeLabel() }
  const a = readNetDev()
  if (!a) return { rxBytesPerSec: null, txBytesPerSec: null, scope }
  await new Promise((r) => setTimeout(r, 200))
  const b = readNetDev()
  if (!b) return { rxBytesPerSec: null, txBytesPerSec: null, scope }
  const dt = 0.2 // ثانیه
  return {
    rxBytesPerSec: Math.max(0, Math.round((b.rx - a.rx) / dt)),
    txBytesPerSec: Math.max(0, Math.round((b.tx - a.tx) / dt)),
    scope,
  }
}

// ─── Uptime ───

function readUptime(): UptimeInfo {
  let host: number | null = null
  try {
    const n = Number(fsSync.readFileSync('/proc/uptime', 'utf8').split(' ')[0])
    host = Number.isFinite(n) && n > 0 ? Math.floor(n) : null
  } catch {
    host = os.uptime() || null
  }
  return { processSeconds: Math.floor(process.uptime()), hostSeconds: host }
}

// ─── نمونهٔ کامل + تاریخچه + هشدارها ───

export async function sampleResources(thresholds: InfraThresholds): Promise<{
  snapshot: ResourcesSnapshot
  alerts: AlertState[]
}> {
  const [cpu, network] = await Promise.all([readCpu(), readNetwork()])
  const memory = readMemory()
  const disks = readDisks()
  const uptime = readUptime()

  // دیسک نمایشی: مصرف پوشهٔ آپلود (مرجع رشد نامحدود)
  const diskPercent = disks.find((d) => d.path === uploadDirPath())?.usedPercent ?? null

  const snapshot: ResourcesSnapshot = {
    generatedAt: Date.now(),
    cpu,
    memory,
    disks,
    network,
    uptime,
    history: [],
    unavailable: buildUnavailable(cpu, memory, disks, network),
  }

  // تاریخچهٔ حلقوی — برای نمودار و «مصرف پایدار»
  const h = history()
  const sample: ResourceSample = {
    at: snapshot.generatedAt,
    cpuPercent: cpu.percent,
    ramPercent: memory.usedPercent,
    diskPercent,
  }
  h.samples.push(sample)
  if (h.samples.length > HISTORY_LIMIT) h.samples.splice(0, h.samples.length - HISTORY_LIMIT)
  snapshot.history = h.samples.slice()

  const alerts = computeAlerts(h.samples, thresholds)
  return { snapshot, alerts }
}

/** فقط آخرین N نمونهٔ پایدار مهم است — هشدار لحظه‌ای = نویز نیست هشدار */
function computeAlerts(samples: ResourceSample[], t: InfraThresholds): AlertState[] {
  const n = Math.min(Math.max(1, t.sustainedCount), 10)
  const last = samples.slice(-n)
  const mk = (metric: 'cpu' | 'ram' | 'disk', threshold: number): AlertState => {
    const vals = last.map((s) => s[metric === 'cpu' ? 'cpuPercent' : metric === 'ram' ? 'ramPercent' : 'diskPercent'])
    const percent = vals.length ? (vals[vals.length - 1] ?? null) : null
    const valid = vals.filter((v): v is number => v !== null)
    // «پایدار» = همهٔ نمونه‌های موجودِ پنجره بالای آستانه (حداقل n نمونه جمع شده باشد)
    const consecutiveOver =
      valid.length > 0 && valid.every((v) => v > threshold) && last.length >= n
        ? valid.length
        : countTrailingOver(vals, threshold)
    return {
      metric,
      active: last.length >= n && valid.length === last.length && valid.every((v) => v > threshold),
      percent,
      threshold,
      consecutiveOver,
    }
  }
  return [mk('cpu', t.cpuThreshold), mk('ram', t.ramThreshold), mk('disk', t.diskThreshold)]
}

function countTrailingOver(vals: (number | null)[], threshold: number): number {
  let c = 0
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i]
    if (v !== null && v > threshold) c++
    else break
  }
  return c
}

function buildUnavailable(
  cpu: CpuInfo,
  memory: MemoryInfo,
  disks: DiskInfo[],
  network: NetworkInfo,
): { metric: string; reason: string }[] {
  const out: { metric: string; reason: string }[] = []
  if (cpu.percent === null) out.push({ metric: 'مصرف CPU', reason: 'خواندن /proc/stat در این محیط ممکن نیست' })
  if (memory.usedPercent === null) out.push({ metric: 'مصرف RAM', reason: 'اطلاعات حافظه قابل خواندن نبود' })
  for (const d of disks) {
    if (d.usedPercent === null)
      out.push({ metric: `دیسک ${d.path}`, reason: 'statfs برای این مسیر در دسترس نیست' })
  }
  if (network.rxBytesPerSec === null) out.push({ metric: 'نرخ شبکه', reason: 'خواندن /proc/net/dev ممکن نیست' })
  // تعداد restart کانتینر: بدون Docker socket عمداً جمع‌آوری نمی‌شود (سیاست امنیتی)
  out.push({
    metric: 'تعداد restart کانتینر',
    reason: 'بدون Docker socket قابل جمع‌آوری نیست — از پنل، دسترسی privileged اضافه نمی‌شود',
  })
  return out
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10))
}
