// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import type { ThemeMode } from '@shared/types'
import { LanguageSelector } from './LanguageSelector'

const MODE_OPTIONS: { value: ThemeMode; labelKey: string }[] = [
  { value: 'system', labelKey: 'general.modes.system' },
  { value: 'light', labelKey: 'general.modes.light' },
  { value: 'dark', labelKey: 'general.modes.dark' },
]

export function GeneralSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const themeConfig = settings.theme

  const handleModeChange = (mode: ThemeMode): void => {
    updateSettings({ ...settings, theme: { ...themeConfig, mode } })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">{t('general.appearance')}</h3>
        <div className="flex items-start gap-4">
          {MODE_OPTIONS.map((opt) => {
            const isActive = themeConfig.mode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleModeChange(opt.value)}
                className="group flex flex-col items-center gap-2 focus:outline-none"
                aria-pressed={isActive}
                aria-label={t(opt.labelKey)}
              >
                <span
                  className={cn(
                    'rounded-xl p-0.5 transition-all',
                    isActive
                      // Solid dark ring for the active card — matches the
                      // prototype's "selected" affordance.
                      ? 'ring-2 ring-[hsl(var(--foreground))]'
                      : 'ring-1 ring-[hsl(var(--border))] group-hover:ring-[hsl(var(--ring)/0.4)]',
                  )}
                >
                  <ThemeModeMockup mode={opt.value} />
                </span>
                <span
                  className={cn(
                    'text-xs transition-colors',
                    isActive
                      ? 'font-semibold text-[hsl(var(--foreground))]'
                      : 'text-[hsl(var(--muted-foreground))]',
                  )}
                >
                  {t(opt.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <LanguageSelector />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ThemeModeMockup — mini app-window preview for the mode picker.
//
// Each card shows a credible miniature of the app (sidebar with nav items +
// content lines) using palette-appropriate colors. The "system" card renders
// a single window split vertically with the left half in the light palette
// and the right half in the dark palette — communicating "follows OS theme"
// at a glance.
//
// Colors are hardcoded hex rather than CSS vars so the preview reads
// the *target* palette, not the currently-active one (a dark-mode user
// previewing the light option should still see the light tones).
// ---------------------------------------------------------------------------

const MOCKUP_W = 130
const MOCKUP_H = 80

function ThemeModeMockup({ mode }: { mode: ThemeMode }): React.JSX.Element {
  if (mode === 'system') {
    return (
      <div
        className="relative overflow-hidden rounded-md"
        style={{ width: MOCKUP_W, height: MOCKUP_H }}
        aria-hidden="true"
      >
        {/* Left half — light palette, anchored to the left so the sidebar
            stays visible. */}
        <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
          <div
            className="absolute top-0 left-0"
            style={{ width: MOCKUP_W, height: MOCKUP_H }}
          >
            <MockupPanel palette="light" />
          </div>
        </div>
        {/* Right half — dark palette, anchored to the right so the content
            lines line up against the right edge. */}
        <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
          <div
            className="absolute top-0 right-0"
            style={{ width: MOCKUP_W, height: MOCKUP_H }}
          >
            <MockupPanel palette="dark" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative overflow-hidden rounded-md"
      style={{ width: MOCKUP_W, height: MOCKUP_H }}
      aria-hidden="true"
    >
      <MockupPanel palette={mode === 'dark' ? 'dark' : 'light'} />
    </div>
  )
}

function MockupPanel({ palette }: { palette: 'light' | 'dark' }): React.JSX.Element {
  const c =
    palette === 'light'
      ? { canvas: '#FEFDFB', sidebar: '#EFE9DC', accent: '#C8BFA8' }
      : { canvas: '#28231F', sidebar: '#1F1C19', accent: '#4A4239' }

  return (
    <div
      className="relative h-full w-full"
      style={{ background: c.canvas }}
    >
      {/* Sidebar strip — 3 stacked nav rows. */}
      <div
        className="absolute top-0 left-0 bottom-0 flex flex-col gap-[3px] pt-2.5 pl-2"
        style={{ width: 32, background: c.sidebar }}
      >
        <span style={{ height: 2, width: 16, borderRadius: 1, background: c.accent }} />
        <span style={{ height: 2, width: 16, borderRadius: 1, background: c.accent }} />
        <span style={{ height: 2, width: 16, borderRadius: 1, background: c.accent }} />
      </div>
      {/* Content lines, right-aligned along the bottom. */}
      <div className="absolute right-2.5 bottom-3 flex flex-col items-end gap-1.5">
        <span style={{ height: 3, width: 58, borderRadius: 1.5, background: c.accent }} />
        <span style={{ height: 3, width: 34, borderRadius: 1.5, background: c.accent }} />
      </div>
    </div>
  )
}
