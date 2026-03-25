// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import type { ThemeMode, ThemeScheme, ThemeTexture } from '@shared/types'
import { THEME_SCHEMES, THEME_TEXTURES, type ThemeSchemeInfo, type ThemeTextureInfo } from '@shared/themeRegistry'
import { LanguageSelector } from './LanguageSelector'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODE_OPTIONS: { value: ThemeMode; labelKey: string; descKey: string }[] = [
  { value: 'system', labelKey: 'general.modes.system', descKey: 'general.modes.systemDesc' },
  { value: 'light', labelKey: 'general.modes.light', descKey: 'general.modes.lightDesc' },
  { value: 'dark', labelKey: 'general.modes.dark', descKey: 'general.modes.darkDesc' },
]

const neutralSchemes = THEME_SCHEMES.filter((s) => s.group === 'neutral')
const accentSchemes = THEME_SCHEMES.filter((s) => s.group === 'accent')

// ---------------------------------------------------------------------------
// GeneralSection
// ---------------------------------------------------------------------------

export function GeneralSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const themeConfig = settings.theme

  const handleModeChange = (mode: ThemeMode): void => {
    updateSettings({ ...settings, theme: { ...themeConfig, mode } })
  }

  const handleSchemeChange = (scheme: ThemeScheme): void => {
    updateSettings({ ...settings, theme: { ...themeConfig, scheme } })
  }

  const handleTextureChange = (texture: ThemeTexture): void => {
    updateSettings({ ...settings, theme: { ...themeConfig, texture } })
  }

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <div>
        <h3 className="text-sm font-medium mb-3">{t('general.appearance')}</h3>
        <div className="grid grid-cols-3 gap-2">
          {MODE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleModeChange(opt.value)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border p-3 text-sm transition-colors',
                themeConfig.mode === opt.value
                  ? 'border-[hsl(var(--ring))] bg-[hsl(var(--primary)/0.08)]'
                  : 'border-[hsl(var(--border))] hover:border-[hsl(var(--ring)/0.5)]'
              )}
              aria-pressed={themeConfig.mode === opt.value}
            >
              <span className="font-medium">{t(opt.labelKey)}</span>
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {t(opt.descKey)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Language selector */}
      <LanguageSelector />

      {/* Scheme selector */}
      <div>
        <h3 className="text-sm font-medium mb-3">{t('general.colorScheme')}</h3>

        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">{t('general.neutral')}</p>
        <div className="flex gap-2 mb-3">
          {neutralSchemes.map((scheme) => (
            <SchemeButton
              key={scheme.id}
              scheme={scheme}
              isActive={themeConfig.scheme === scheme.id}
              onClick={() => handleSchemeChange(scheme.id)}
            />
          ))}
        </div>

        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-2">{t('general.accent')}</p>
        <div className="flex gap-2">
          {accentSchemes.map((scheme) => (
            <SchemeButton
              key={scheme.id}
              scheme={scheme}
              isActive={themeConfig.scheme === scheme.id}
              onClick={() => handleSchemeChange(scheme.id)}
            />
          ))}
        </div>
      </div>

      {/* Texture selector */}
      <div>
        <h3 className="text-sm font-medium mb-3">{t('general.surfaceTexture')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {THEME_TEXTURES.map((texture) => (
            <TextureButton
              key={texture.id}
              texture={texture}
              isActive={themeConfig.texture === texture.id}
              onClick={() => handleTextureChange(texture.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TextureButton
// ---------------------------------------------------------------------------

function TextureButton({
  texture,
  isActive,
  onClick,
}: {
  texture: ThemeTextureInfo
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        isActive
          ? 'border-[hsl(var(--ring))] bg-[hsl(var(--primary)/0.08)]'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--ring)/0.5)]'
      )}
      aria-pressed={isActive}
      title={texture.description}
    >
      {/* Mini swatch preview */}
      <span
        className={cn(
          'h-8 w-8 shrink-0 rounded-md border border-[hsl(var(--border))]',
          texture.previewClass,
        )}
        aria-hidden="true"
      />
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium">{texture.label}</span>
        <span className="text-[10px] text-[hsl(var(--muted-foreground))] leading-tight">
          {texture.description}
        </span>
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// SchemeButton
// ---------------------------------------------------------------------------

function SchemeButton({
  scheme,
  isActive,
  onClick,
}: {
  scheme: ThemeSchemeInfo
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-lg border p-2 text-xs transition-colors min-w-[52px]',
        isActive
          ? 'border-[hsl(var(--ring))] bg-[hsl(var(--primary)/0.08)]'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--ring)/0.5)]'
      )}
      aria-pressed={isActive}
      title={scheme.label}
    >
      <span
        className="h-5 w-5 rounded-full border border-[hsl(var(--border))]"
        style={{ backgroundColor: `hsl(${scheme.swatch})` }}
        aria-hidden="true"
      />
      <span className="font-medium">{scheme.label}</span>
    </button>
  )
}
