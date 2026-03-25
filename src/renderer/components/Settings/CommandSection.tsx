// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import type { CommandDefaults, PermissionMode } from '@shared/types'

export function CommandSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const cmd = settings.command

  const handleChange = <K extends keyof CommandDefaults>(field: K, value: CommandDefaults[K]): void => {
    updateSettings({
      ...settings,
      command: { ...settings.command, [field]: value }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t('command.title')}</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mb-4">
          {t('command.description')}
        </p>
        <div className="space-y-4">
          {/* Max Turns */}
          <div>
            <label className="block text-sm font-medium mb-1">{t('command.maxTurns')}</label>
            <input
              type="number"
              value={cmd.maxTurns}
              onChange={(e) => handleChange('maxTurns', parseInt(e.target.value) || 0)}
              min={1}
              max={100000}
              className="w-28 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            />
          </div>

          {/* Permission Mode */}
          <div>
            <label className="block text-sm font-medium mb-1">{t('command.permissionMode')}</label>
            <select
              value={cmd.permissionMode}
              onChange={(e) => handleChange('permissionMode', e.target.value as PermissionMode)}
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-1.5 text-sm outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
            >
              <option value="bypassPermissions">{t('command.bypassPermissions')}</option>
              <option value="default">{t('command.defaultPermission')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
