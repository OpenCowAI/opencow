// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import type { LanguagePref } from '@shared/i18n'

const LANGUAGE_OPTIONS: { value: LanguagePref; labelKey: string }[] = [
  { value: 'system', labelKey: 'general.languageOptions.system' },
  { value: 'zh-CN', labelKey: 'general.languageOptions.zh-CN' },
  { value: 'en-US', labelKey: 'general.languageOptions.en-US' },
]

export function LanguageSelector(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const currentLanguage: LanguagePref = settings.language ?? 'system'

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const newValue = e.target.value as LanguagePref
    updateSettings({ ...settings, language: newValue })
  }

  return (
    <div>
      <h3 className="text-sm font-medium mb-3">{t('general.language')}</h3>
      <select
        value={currentLanguage}
        onChange={handleChange}
        className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-2 text-sm transition-colors hover:border-[hsl(var(--ring)/0.5)] focus:border-[hsl(var(--ring))] focus:outline-none"
      >
        {LANGUAGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
    </div>
  )
}
