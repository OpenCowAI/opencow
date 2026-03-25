// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyLocale } from '@/i18n'
import type { SupportedLocale } from '@shared/i18n'

/**
 * Lightweight language toggle for the onboarding flow.
 *
 * Unlike the LanguageSelector in Settings, this component does NOT depend on
 * `settings` being loaded — it reads the current locale directly from i18next
 * and applies the change immediately via `applyLocale()`.
 *
 * If settings are already available, it also persists the preference via
 * `updateSettings()` so the choice survives app restarts.
 */
export function OnboardingLanguageSwitcher(): React.JSX.Element {
  const { i18n } = useTranslation()
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const currentLocale = i18n.language as SupportedLocale
  const nextLocale: SupportedLocale = currentLocale === 'zh-CN' ? 'en-US' : 'zh-CN'
  const label = currentLocale === 'zh-CN' ? 'EN' : '中文'

  const handleToggle = (): void => {
    // 1. Immediately switch the UI language (no round-trip needed)
    void applyLocale(nextLocale)

    // 2. Persist the preference if settings are loaded
    if (settings) {
      void updateSettings({ ...settings, language: nextLocale })
    }
  }

  return (
    <button
      onClick={handleToggle}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))]"
      aria-label={`Switch language to ${nextLocale}`}
    >
      <Globe className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
