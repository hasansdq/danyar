import { db } from '@/lib/db'
import { getSession } from '@/lib/session'
import {
  PRESET_FONTS,
  FALLBACK_STACK,
  schoolDisplayName,
  isValidHexColor,
  BRANDING_DEFAULTS,
  type PlatformSettings,
} from './fonts'

// تعاریف مشترک فونت/برندینگ — برای استفاده کلاینت از @/lib/fonts ایمپورت شود
export { PRESET_FONTS, FALLBACK_STACK, schoolDisplayName, isValidHexColor, BRANDING_DEFAULTS } from './fonts'
export type { PlatformSettings, PresetFont } from './fonts'

export const PLATFORM_SETTING_ID = 'global'

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const row = await db.platformSetting.findUnique({ where: { id: PLATFORM_SETTING_ID } })
  if (row) return row as unknown as PlatformSettings
  const created = await db.platformSetting.create({ data: { id: PLATFORM_SETTING_ID } }).catch(() => null)
  return (created as unknown as PlatformSettings) ?? { ...BRANDING_DEFAULTS }
}

export function assetUrl(key: string | null | undefined): string | null {
  if (!key) return null
  // کلید به شکل «branding/{name}» است؛ مسیر asset/[name] فقط نام می‌پذیرد
  // (انکود کلید با encodeURIComponent اسلش را هم → %2F می‌کرد و URL 404 می‌شد)
  const name = key.startsWith('branding/') ? key.slice('branding/'.length) : key
  return `/api/branding/asset/${encodeURIComponent(name)}`
}

/** فونت فعال برنامه: آپلود سفارشی مقدم بر پیش‌فرض است */
export function activeFontCss(s: PlatformSettings): { family: string; css: string } {
  const faces: string[] = []
  for (const p of PRESET_FONTS) {
    if (p.key === 'vazirmatn') continue // در globals.css ثبت شده
    faces.push(
      `@font-face{font-family:"${p.family}";src:url("${p.file}") format("woff2");font-weight:400;font-style:normal;font-display:swap;}`,
    )
  }
  let family = PRESET_FONTS.find((p) => p.key === s.fontPreset)?.family ?? 'Vazirmatn'
  if (s.fontCustomKey) {
    const url = assetUrl(s.fontCustomKey)
    if (url) {
      const ext = (s.fontCustomKey.split('.').pop() ?? 'woff2').toLowerCase()
      const fmt = ext === 'ttf' ? 'truetype' : ext === 'otf' ? 'opentype' : 'woff2'
      faces.push(
        `@font-face{font-family:"DaniarCustom";src:url("${url}") format("${fmt}");font-weight:100 900;font-style:normal;font-display:swap;}`,
      )
      family = 'DaniarCustom'
    }
  }
  return { family, css: faces.join('\n') }
}

/** CSS تزریق‌شدنی در ریشه برنامه (فونت + پس‌زمینه چت موبایل) */
export function injectedCss(s: PlatformSettings): string {
  const { family, css } = activeFontCss(s)
  // متغیر فونت هر پیش‌فرض — برای انتخاب فونت متن‌های اسپلش
  const presetVars = PRESET_FONTS.map((p) => `--font-preset-${p.key}:"${p.family}",${FALLBACK_STACK};`).join('')
  // پس‌زمینه حالت روشن و تیره جداگانه — اگر تصویر تیره انتخاب نشده باشد،
  // همان تصویر روشن با لایه تیره‌تر استفاده می‌شود (سازگار با رفتار قبلی)
  const chatBgLight = assetUrl(s.chatBgKey)
  const chatBgDark = assetUrl(s.chatBgDarkKey) ?? chatBgLight
  let chatCss = ''
  if (chatBgLight) {
    chatCss = `
@media (max-width:1023px){
  .chat-messages-bg{
    background-image:linear-gradient(rgba(255,255,255,.78),rgba(255,255,255,.78)),url("${chatBgLight}");
    background-size:cover;background-position:center;background-attachment:local;
  }
}`
  }
  if (chatBgDark) {
    chatCss += `
@media (max-width:1023px){
  .dark .chat-messages-bg{
    background-image:linear-gradient(rgba(8,16,20,.72),rgba(8,16,20,.72)),url("${chatBgDark}");
    background-size:cover;background-position:center;background-attachment:local;
  }
}`
  }
  return `${css}
:root{--app-font:"${family}",${FALLBACK_STACK}!important;${presetVars}}
body{font-family:var(--app-font);}
${chatCss}`
}

export interface BrandingPatch {
  appName?: string
  fontPreset?: string
  splashDurationMs?: number
  splashAppNameSize?: number
  splashDisplayNameSize?: number
  splashAppNameColor?: string
  splashDisplayNameColor?: string
  splashAppNameFont?: string
  splashDisplayNameFont?: string
  splashEnabled?: boolean
  splashShowAppName?: boolean
  splashShowDisplayName?: boolean
  logoKey?: string | null
  fontCustomKey?: string | null
  chatBgKey?: string | null
  chatBgDarkKey?: string | null
  splashBgKey?: string | null
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)))

/** ذخیره تنظیمات با اعتبارسنجی کامل — مقادیر نامعتبر هرگز ذخیره نمی‌شوند */
export async function updatePlatformSettings(patch: BrandingPatch): Promise<PlatformSettings> {
  await getPlatformSettings() // تضمین وجود رکورد
  const data: Record<string, unknown> = {}

  if (patch.appName !== undefined) {
    const name = patch.appName.trim()
    if (name.length < 1 || name.length > 40) throw new Error('نام اپلیکیشن باید ۱ تا ۴۰ کاراکتر باشد')
    data.appName = name
  }
  if (patch.fontPreset !== undefined) {
    if (!PRESET_FONTS.some((p) => p.key === patch.fontPreset)) throw new Error('فونت پیش‌فرض نامعتبر است')
    data.fontPreset = patch.fontPreset
  }
  if (patch.splashDurationMs !== undefined) {
    data.splashDurationMs = clamp(patch.splashDurationMs, 500, 15000)
  }
  if (patch.splashAppNameSize !== undefined) {
    data.splashAppNameSize = clamp(patch.splashAppNameSize, 24, 160)
  }
  if (patch.splashDisplayNameSize !== undefined) {
    data.splashDisplayNameSize = clamp(patch.splashDisplayNameSize, 10, 64)
  }
  for (const k of ['splashAppNameColor', 'splashDisplayNameColor'] as const) {
    const v = patch[k]
    if (v !== undefined) {
      if (!isValidHexColor(v)) throw new Error('رنگ باید به فرمت #RRGGBB باشد')
      data[k] = v
    }
  }
  for (const k of ['splashAppNameFont', 'splashDisplayNameFont'] as const) {
    const v = patch[k]
    if (v !== undefined) data[k] = v === '' || PRESET_FONTS.some((p) => p.key === v) ? v : ''
  }
  for (const k of ['splashEnabled', 'splashShowAppName', 'splashShowDisplayName'] as const) {
    if (patch[k] !== undefined) data[k] = !!patch[k]
  }
  for (const k of ['logoKey', 'fontCustomKey', 'chatBgKey', 'chatBgDarkKey', 'splashBgKey'] as const) {
    if (patch[k] !== undefined) {
      const v = patch[k]
      if (v === null || v === '') data[k] = null
      else if (!/^branding\/[a-z0-9-]+\.(woff2|woff|ttf|otf|png|jpg|jpeg|webp|svg|gif)$/i.test(v)) {
        throw new Error('شناسه فایل نامعتبر است')
      } else data[k] = v
    }
  }

  const row = await db.platformSetting.update({ where: { id: PLATFORM_SETTING_ID }, data })
  return row as unknown as PlatformSettings
}

// ─── payload مشترک برای API عمومی و ریشه برنامه ───

export interface BrandingPayload {
  appName: string
  logoUrl: string | null
  schoolDisplayName: string | null
  font: { preset: string; customUrl: string | null }
  splash: {
    enabled: boolean
    durationMs: number
    showAppName: boolean
    showDisplayName: boolean
    bgUrl: string | null
    appNameFont: string
    appNameColor: string
    appNameSize: number
    displayNameFont: string
    displayNameColor: string
    displayNameSize: number
  }
  chatBgUrl: string | null
  chatBgDarkUrl: string | null
}

/**
 * payload کامل برندینگ برای کاربر فعلی (نشست اختیاری).
 * در زمان بیلد (بدون دیتابیس) مقادیر پیش‌فرض برمی‌گردد تا بیلد هرگز نشکند.
 */
export async function getBrandingPayload(): Promise<BrandingPayload> {
  try {
    const s = await getPlatformSettings()
    const session = await getSession().catch(() => null)
    let schoolDisplayNameValue: string | null = null
    if (session?.schoolId) {
      const school = await db.school.findUnique({
        where: { id: session.schoolId },
        select: { name: true },
      })
      if (school) schoolDisplayNameValue = schoolDisplayName(school.name)
    }
    return {
      appName: s.appName,
      logoUrl: assetUrl(s.logoKey),
      schoolDisplayName: schoolDisplayNameValue,
      font: { preset: s.fontPreset, customUrl: assetUrl(s.fontCustomKey) },
      splash: {
        enabled: s.splashEnabled,
        durationMs: s.splashDurationMs,
        showAppName: s.splashShowAppName,
        showDisplayName: s.splashShowDisplayName,
        bgUrl: assetUrl(s.splashBgKey),
        appNameFont: s.splashAppNameFont,
        appNameColor: s.splashAppNameColor,
        appNameSize: s.splashAppNameSize,
        displayNameFont: s.splashDisplayNameFont,
        displayNameColor: s.splashDisplayNameColor,
        displayNameSize: s.splashDisplayNameSize,
      },
      chatBgUrl: session ? assetUrl(s.chatBgKey) : null,
      // حالت تیره: تصویر اختصاصی تیره، وگرنه همان تصویر روشن (با لایه تیره)
      chatBgDarkUrl: session ? (assetUrl(s.chatBgDarkKey) ?? assetUrl(s.chatBgKey)) : null,
    }
  } catch {
    // زمان بیلد یا نبود دیتابیس — پیش‌فرض امن (اسپلش غیرفعال تا تنظیم واقعی خوانده شود)
    const d = BRANDING_DEFAULTS
    return {
      appName: d.appName,
      logoUrl: null,
      schoolDisplayName: null,
      font: { preset: d.fontPreset, customUrl: null },
      splash: {
        enabled: false,
        durationMs: d.splashDurationMs,
        showAppName: d.splashShowAppName,
        showDisplayName: d.splashShowDisplayName,
        bgUrl: null,
        appNameFont: d.splashAppNameFont,
        appNameColor: d.splashAppNameColor,
        appNameSize: d.splashAppNameSize,
        displayNameFont: d.splashDisplayNameFont,
        displayNameColor: d.splashDisplayNameColor,
        displayNameSize: d.splashDisplayNameSize,
      },
      chatBgUrl: null,
      chatBgDarkUrl: null,
    }
  }
}
