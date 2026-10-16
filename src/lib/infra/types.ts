/**
 * انواع مشترک پایش زیرساخت — پنل مدیر کل (/superadmin/infrastructure)
 *
 * اصل طلایی: هیچ مقدار محرمانه (کلید/رمز/توکن/رشته اتصال) در هیچ‌یک از
 * این ساختارها قرار نمی‌گیرد؛ خروجی API فقط وضعیت، زمان و پیام فارسی است.
 */

export type ServiceCheckStatus =
  | 'ok' // سالم
  | 'degraded' // اختلال
  | 'checking' // در حال بررسی
  | 'not_configured' // تنظیم نشده
  | 'unchecked' // بررسی نشده

export type ServiceKey =
  | 'web'
  | 'db'
  | 'upload'
  | 'socket'
  | 'livekit'
  | 'turn'

export interface ServiceCheck {
  key: ServiceKey
  /** برچسب فارسی سرویس */
  label: string
  status: ServiceCheckStatus
  /** زمان پاسخ بر حسب میلی‌ثانیه (اگر قابل اندازه‌گیری بود) */
  latencyMs: number | null
  /** زمان آخرین بررسی (epoch ms) */
  checkedAt: number
  /** شرح فارسی خطا/اختلال — فقط پیام امن بدون محرمانه */
  error: string | null
  /** اقدام پیشنهادی برای رفع */
  hint: string | null
  /** جزئیات بی‌خطر اضافی برای نمایش (اختیاری) */
  detail: string | null
}

export type RunMode = 'preview' | 'docker' | 'direct' | 'unknown'

export interface RunModeInfo {
  mode: RunMode
  /** برچسب فارسی حالت اجرا */
  label: string
  /** منبع تشخیص — صادقانه؛ تشخیص حدسی هرگز قطعی اعلام نمی‌شود */
  source: string
}

export interface ResourceSample {
  at: number
  cpuPercent: number | null
  ramPercent: number | null
  diskPercent: number | null
}

export interface ResourceScope {
  /** برچسب منبع: کانتینر / میزبان VPS / محیط پیش‌نمایش */
  label: string
}

export interface CpuInfo {
  percent: number | null
  cores: number
  /** محدودیت CPU کانتینر (هسته) در صورت وجود منبع معتبر */
  containerCoreLimit: number | null
  load1: number | null
  load5: number | null
  load15: number | null
  scope: ResourceScope | null
}

export interface MemoryInfo {
  usedPercent: number | null
  totalBytes: number | null
  usedBytes: number | null
  freeBytes: number | null
  /** سقف حافظه کانتینر (cgroup یا نشانگر محیط) */
  containerLimitBytes: number | null
  processRssBytes: number | null
  scope: ResourceScope | null
}

export interface DiskInfo {
  path: string
  usedPercent: number | null
  totalBytes: number | null
  freeBytes: number | null
  scope: ResourceScope | null
}

export interface NetworkInfo {
  /** بایت بر ثانیه از آخرین نمونه‌برداری */
  rxBytesPerSec: number | null
  txBytesPerSec: number | null
  scope: ResourceScope | null
}

export interface UptimeInfo {
  /** ثانیه از شروع پروسهٔ Next.js */
  processSeconds: number
  /** ثانیه از بوت میزبان/محیط */
  hostSeconds: number | null
}

export interface ResourcesSnapshot {
  generatedAt: number
  cpu: CpuInfo
  memory: MemoryInfo
  disks: DiskInfo[]
  network: NetworkInfo
  uptime: UptimeInfo
  /** نمونه‌های اخیر برای نمودار کوتاه (قدیمی‌ترین اول) */
  history: ResourceSample[]
  /** شاخص‌های غیرقابل‌دسترس با دلیل صریح */
  unavailable: { metric: string; reason: string }[]
}

export interface AlertState {
  metric: 'cpu' | 'ram' | 'disk'
  active: boolean
  percent: number | null
  threshold: number
  /** تعداد نمونهٔ متوادی بالای آستانه (برای تمایز پایدار/لحظه‌ای) */
  consecutiveOver: number
}

export interface InfraThresholds {
  cpuThreshold: number
  ramThreshold: number
  diskThreshold: number
  sustainedCount: number
}

export interface InfraEvent {
  id: string
  kind: 'error' | 'alert' | 'recovery'
  service: string
  message: string
  detail: string | null
  createdAt: string
}

/** برچسب فارسی وضعیت سرویس — تنها منبع ترجمه UI */
export const STATUS_LABELS: Record<ServiceCheckStatus, string> = {
  ok: 'سالم',
  degraded: 'اختلال',
  checking: 'در حال بررسی',
  not_configured: 'تنظیم نشده',
  unchecked: 'بررسی نشده',
}

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  preview: 'پیش‌نمایش Z.AI',
  docker: 'Docker',
  direct: 'اجرا مستقیم',
  unknown: 'نامشخص',
}
