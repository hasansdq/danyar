/**
 * تعاریف مشترک فونت/برندینگ — بدون هیچ وابستگی سروری (قابل استفاده در کلاینت)
 */

export interface PresetFont {
  key: string
  label: string
  /** نام font-family که در CSS ثبت می‌شود */
  family: string
  file: string
}

/** فونت‌های پیش‌فرض ترند (فارسی) — فایل‌ها در public/fonts هستند */
export const PRESET_FONTS: PresetFont[] = [
  { key: 'vazirmatn', label: 'وزیرمتن (پیش‌فرض)', family: 'Vazirmatn', file: '/fonts/Vazirmatn-Variable.woff2' },
  { key: 'estedad', label: 'استعداد', family: 'Estedad', file: '/fonts/presets/estedad-arabic-400.woff2' },
  { key: 'lalezar', label: 'لاله‌زار', family: 'Lalezar', file: '/fonts/presets/lalezar-arabic-400.woff2' },
  { key: 'markazi-text', label: 'مرکزی', family: 'Markazi Text', file: '/fonts/presets/markazi-text-arabic-400.woff2' },
  { key: 'noto-naskh', label: 'نسخ نوتو', family: 'Noto Naskh Arabic', file: '/fonts/presets/noto-naskh-arabic-400.woff2' },
]

export const FALLBACK_STACK = '"Segoe UI", Tahoma, sans-serif'

/** الگوی نام نمایشی هر مدرسه — مثال: مدرسه هوشمند شهید بهشتی */
export function schoolDisplayName(schoolName: string): string {
  const name = (schoolName ?? '').trim()
  if (!name) return ''
  if (name.startsWith('مدرسه')) return name
  return `مدرسه هوشمند ${name}`
}

export function isValidHexColor(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

export interface PlatformSettings {
  appName: string
  logoKey: string | null
  fontPreset: string
  fontCustomKey: string | null
  chatBgKey: string | null
  chatBgDarkKey: string | null
  splashEnabled: boolean
  splashDurationMs: number
  splashShowAppName: boolean
  splashShowDisplayName: boolean
  splashBgKey: string | null
  splashAppNameFont: string
  splashAppNameColor: string
  splashAppNameSize: number
  splashDisplayNameFont: string
  splashDisplayNameColor: string
  splashDisplayNameSize: number
}

export const BRANDING_DEFAULTS: PlatformSettings = {
  appName: 'دانیار',
  logoKey: null,
  fontPreset: 'vazirmatn',
  fontCustomKey: null,
  chatBgKey: null,
  chatBgDarkKey: null,
  splashEnabled: true,
  splashDurationMs: 2200,
  splashShowAppName: true,
  splashShowDisplayName: true,
  splashBgKey: null,
  splashAppNameFont: '',
  splashAppNameColor: '#0f766e',
  splashAppNameSize: 56,
  splashDisplayNameFont: '',
  splashDisplayNameColor: '#475569',
  splashDisplayNameSize: 16,
}
