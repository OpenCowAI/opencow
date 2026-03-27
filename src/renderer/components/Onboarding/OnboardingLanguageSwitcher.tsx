// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyLocale } from '@/i18n'
import type { SupportedLocale } from '@shared/i18n'

const LOCALE_OPTIONS: { value: SupportedLocale; label: string }[] = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
]

/**
 * Lightweight language selector for the onboarding flow.
 *
 * Rendered as a native <select> to guarantee click-ability even inside
 * Electron's title-bar drag region (native controls pierce -webkit-app-region).
 *
 * Unlike the LanguageSelector in Settings, this component does NOT depend on
 * `settings` being loaded — it reads the current locale directly from i18next
 * and applies the change immediately via `applyLocale()`.
 */
export function OnboardingLanguageSwitcher(): React.JSX.Element {
  const { i18n } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const currentLocale = (i18n.language || 'en-US') as SupportedLocale

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const locale = e.target.value as SupportedLocale

    // 1. Immediately switch the UI language (no round-trip needed)
    void applyLocale(locale)

    // 2. Persist the preference if settings are loaded
    if (settings) {
      void updateSettings({ ...settings, language: locale })
    }
  }

  return (
    <select
      value={currentLocale}
      onChange={handleChange}
      className="no-drag cursor-pointer appearance-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5 pr-7 text-xs font-medium text-[hsl(var(--foreground))] shadow-sm outline-none transition-colors hover:bg-[hsl(var(--accent))] focus:ring-1 focus:ring-[hsl(var(--ring))]"
      aria-label="Switch language"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {LOCALE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
