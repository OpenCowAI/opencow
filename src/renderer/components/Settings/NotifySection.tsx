// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import type { EventSubscriptionSettings } from '@shared/types'

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-[hsl(var(--border))] accent-[hsl(var(--ring))]"
      />
      <div>
        <span className="text-sm font-medium">{label}</span>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
    </label>
  )
}

export function NotifySection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const prefs = settings.eventSubscriptions

  const handleChange = (field: keyof EventSubscriptionSettings, value: boolean): void => {
    updateSettings({
      ...settings,
      eventSubscriptions: { ...settings.eventSubscriptions, [field]: value }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t('notifications.title')}</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
          {t('notifications.description')}
        </p>
        <div className="space-y-4">
          <ToggleRow
            label={t('notifications.enableNotifications')}
            description={t('notifications.enableDesc')}
            checked={prefs.enabled}
            onChange={(v) => handleChange('enabled', v)}
          />
          <div className="pl-7 space-y-3 border-l-2 border-[hsl(var(--border))] ml-2">
            <ToggleRow
              label={t('notifications.onError')}
              description={t('notifications.onErrorDesc')}
              checked={prefs.onError}
              disabled={!prefs.enabled}
              onChange={(v) => handleChange('onError', v)}
            />
            <ToggleRow
              label={t('notifications.onComplete')}
              description={t('notifications.onCompleteDesc')}
              checked={prefs.onComplete}
              disabled={!prefs.enabled}
              onChange={(v) => handleChange('onComplete', v)}
            />
            <ToggleRow
              label={t('notifications.onStatusChange')}
              description={t('notifications.onStatusChangeDesc')}
              checked={prefs.onStatusChange}
              disabled={!prefs.enabled}
              onChange={(v) => handleChange('onStatusChange', v)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
