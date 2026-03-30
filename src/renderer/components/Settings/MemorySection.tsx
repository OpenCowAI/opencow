// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAppAPI } from '@/windowAPI'
import type { MemorySettings } from '@shared/types'
import { MEMORY_DEFAULTS } from '@shared/types'
import { Switch } from '@/components/ui/switch'

export function MemorySection(): React.JSX.Element {
  const { t } = useTranslation('memory')
  const [settings, setSettings] = useState<MemorySettings>(MEMORY_DEFAULTS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const api = getAppAPI()
    api['memory:get-settings']().then((s) => {
      setSettings(s)
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  const updateField = useCallback(async <K extends keyof MemorySettings>(key: K, value: MemorySettings[K]) => {
    const prev = { ...settings }
    const patch = { [key]: value } as Partial<MemorySettings>
    setSettings((s) => ({ ...s, ...patch }))
    try {
      const api = getAppAPI()
      await api['memory:update-settings'](null, patch)
    } catch {
      // Revert optimistic update on failure
      setSettings(prev)
    }
  }, [settings])

  if (!loaded) return <div className="p-4 text-xs text-[hsl(var(--muted-foreground))]">{t('detail.loading')}</div>

  return (
    <div className="space-y-6 p-1">
      <div>
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-1">{t('settings.title')}</h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{t('settings.description')}</p>
      </div>

      <ToggleRow
        label={t('settings.enable')}
        description={t('settings.enableDesc')}
        checked={settings.enabled}
        onChange={(v) => void updateField('enabled', v)}
      />

      <ToggleRow
        label={t('settings.silentMode')}
        description={t('settings.silentModeDesc')}
        checked={settings.autoConfirm}
        onChange={(v) => void updateField('autoConfirm', v)}
      />

      {!settings.autoConfirm && (
        <SettingRow label={t('settings.autoConfirmTimeout')} description={t('settings.autoConfirmTimeoutDesc')}>
          <select
            value={settings.confirmTimeoutSeconds}
            onChange={(e) => void updateField('confirmTimeoutSeconds', Number(e.target.value))}
            className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-2 text-sm transition-colors hover:border-[hsl(var(--ring)/0.5)] focus:border-[hsl(var(--ring))] focus:outline-none"
            aria-label={t('settings.autoConfirmTimeout')}
          >
            {[5, 10, 15, 20, 30].map((s) => (
              <option key={s} value={s}>{t('settings.seconds', { count: s })}</option>
            ))}
          </select>
        </SettingRow>
      )}

      <SettingRow label={t('settings.extractionDelay')} description={t('settings.extractionDelayDesc')}>
        <select
          value={settings.extractionDelaySeconds}
          onChange={(e) => void updateField('extractionDelaySeconds', Number(e.target.value))}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-2 text-sm transition-colors hover:border-[hsl(var(--ring)/0.5)] focus:border-[hsl(var(--ring))] focus:outline-none"
          aria-label={t('settings.extractionDelay')}
        >
          {[5, 10, 15, 20, 30].map((s) => (
            <option key={s} value={s}>{t('settings.seconds', { count: s })}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label={t('settings.maxMemories')} description={t('settings.maxMemoriesDesc')}>
        <select
          value={settings.maxMemories}
          onChange={(e) => void updateField('maxMemories', Number(e.target.value))}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-2 text-sm transition-colors hover:border-[hsl(var(--ring)/0.5)] focus:border-[hsl(var(--ring))] focus:outline-none"
          aria-label={t('settings.maxMemories')}
        >
          {[50, 100, 200, 500].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow label={t('settings.autoArchive')} description={t('settings.autoArchiveDesc')}>
        <select
          value={settings.autoArchiveDays}
          onChange={(e) => void updateField('autoArchiveDays', Number(e.target.value))}
          className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] pl-3 pr-8 py-2 text-sm transition-colors hover:border-[hsl(var(--ring)/0.5)] focus:border-[hsl(var(--ring))] focus:outline-none"
          aria-label={t('settings.autoArchive')}
        >
          {[30, 60, 90, 180, 365].map((d) => (
            <option key={d} value={d}>{t('settings.days', { count: d })}</option>
          ))}
        </select>
      </SettingRow>
    </div>
  )
}

// ─── Reusable Row Components ───────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">{label}</p>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-medium text-[hsl(var(--foreground))]">{label}</p>
        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">{description}</p>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        size="sm"
        label={label}
      />
    </div>
  )
}
