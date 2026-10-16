/**
 * نمای اسپلش — مشترک بین اسپلش واقعی برنامه و پیش‌نمایش پنل مدیر کل
 * همه مقادیر از تنظیمات می‌آید؛ هیچ مقدار هاردکد در UI نیست.
 */
import type { Branding } from '@/lib/use-branding'

export interface SplashViewProps {
  appName: string
  schoolDisplayName: string | null
  splash: Branding['splash']
  /** پیش‌نمایش داخل پنل — بدون لایه تمام‌صفحه */
  previewMode?: boolean
}

export function SplashView({ appName, schoolDisplayName, splash: s, previewMode }: SplashViewProps) {
  const appFont = s.appNameFont
    ? `var(--font-preset-${s.appNameFont}, var(--app-font))`
    : 'var(--app-font)'
  const dispFont = s.displayNameFont
    ? `var(--font-preset-${s.displayNameFont}, var(--app-font))`
    : 'var(--app-font)'

  return (
    <div
      data-testid={previewMode ? undefined : 'splash-screen'}
      className={
        previewMode
          ? 'relative flex h-64 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border'
          : 'fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 transition-opacity duration-300'
      }
      style={{
        backgroundColor: 'var(--background)',
        backgroundImage: s.bgUrl ? `url("${s.bgUrl}")` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
      aria-hidden={previewMode ? undefined : 'true'}
    >
      {s.bgUrl && <div className="absolute inset-0 bg-background/55" />}

      <div className="relative flex flex-col items-center gap-3 px-6 text-center">
        {s.showAppName && (
          <h1
            style={{
              color: s.appNameColor,
              fontFamily: appFont,
              fontSize: previewMode ? `${Math.max(22, s.appNameSize * 0.55)}px` : `${s.appNameSize}px`,
              lineHeight: 1.25,
              fontWeight: 800,
              textShadow: s.bgUrl ? '0 2px 18px rgba(0,0,0,.35)' : undefined,
            }}
          >
            {appName}
          </h1>
        )}
        {s.showDisplayName && schoolDisplayName && (
          <p
            style={{
              color: s.displayNameColor,
              fontFamily: dispFont,
              fontSize: previewMode ? `${Math.max(11, s.displayNameSize * 0.9)}px` : `${s.displayNameSize}px`,
              lineHeight: 1.6,
              fontWeight: 600,
              textShadow: s.bgUrl ? '0 1px 10px rgba(0,0,0,.3)' : undefined,
            }}
          >
            {schoolDisplayName}
          </p>
        )}
        {!s.showDisplayName && !s.showAppName && (
          <p className="text-xs text-muted-foreground">متن‌ها از نمایش خارج شده‌اند — فقط لودینگ نمایش داده می‌شود</p>
        )}

        {/* لودینگ متحرک */}
        <span
          className={`mt-4 inline-block animate-spin rounded-full ${previewMode ? 'h-7 w-7' : 'h-9 w-9'}`}
          style={{
            border: '3px solid color-mix(in srgb, var(--primary) 25%, transparent)',
            borderTopColor: 'var(--primary)',
          }}
        />
      </div>
    </div>
  )
}
