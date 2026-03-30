// SPDX-License-Identifier: Apache-2.0

/**
 * UpdateSection — Settings tab for configuring update check preferences.
 *
 * Allows users to:
 *   - Toggle automatic update checking on/off
 *   - Choose the check interval (1h, 4h, 12h, 24h)
 *   - See current version and last-checked timestamp
 *   - Trigger a manual check with clear result feedback
 */

import { useTranslation } from 'react-i18next'
import { Check, ArrowUpRight, Download, Loader2 } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUpdateStore } from '@/stores/updateStore'
import { APP_VERSION } from '@shared/appIdentity'
import type { UpdateCheckInterval } from '@shared/types'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'

const INTERVAL_OPTIONS: { value: UpdateCheckInterval; labelKey: string }[] = [
  { value: '1h', labelKey: 'updates.intervals.1h' },
  { value: '4h', labelKey: 'updates.intervals.4h' },
  { value: '12h', labelKey: 'updates.intervals.12h' },
  { value: '24h', labelKey: 'updates.intervals.24h' },
]

export function UpdateSection(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const settings = useSettingsStore((s) => s.settings)!
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const updateAvailable = useUpdateStore((s) => s.updateAvailable)
  const latestVersion = useUpdateStore((s) => s.latestVersion)
  const releaseUrl = useUpdateStore((s) => s.releaseUrl)
  const downloadUrl = useUpdateStore((s) => s.downloadUrl)
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt)
  const checking = useUpdateStore((s) => s.checking)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)

  const { autoCheckUpdates, updateCheckInterval } = settings.updates

  // Derive: we've completed at least one check and the result is "up to date"
  const isUpToDate = !checking && !updateAvailable && lastCheckedAt !== null

  const handleToggleAutoCheck = (): void => {
    updateSettings({
      ...settings,
      updates: { ...settings.updates, autoCheckUpdates: !autoCheckUpdates },
    })
  }

  const handleIntervalChange = (interval: UpdateCheckInterval): void => {
    updateSettings({
      ...settings,
      updates: { ...settings.updates, updateCheckInterval: interval },
    })
  }

  return (
    <div className="space-y-6">
      {/* Auto-check toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">{t('updates.autoCheck')}</h3>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
            {t('updates.autoCheckDesc')}
          </p>
        </div>
        <Switch
          checked={autoCheckUpdates}
          onChange={() => handleToggleAutoCheck()}
          size="sm"
          label={t('updates.autoCheck')}
        />
      </div>

      {/* Check interval */}
      {autoCheckUpdates && (
        <div>
          <h3 className="text-sm font-medium mb-2">{t('updates.checkInterval')}</h3>
          <div className="grid grid-cols-4 gap-2">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleIntervalChange(opt.value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-xs transition-colors',
                  updateCheckInterval === opt.value
                    ? 'border-[hsl(var(--ring))] bg-[hsl(var(--primary)/0.08)] font-medium'
                    : 'border-[hsl(var(--border))] hover:border-[hsl(var(--ring)/0.5)]',
                )}
                aria-pressed={updateCheckInterval === opt.value}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Version info card */}
      <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[hsl(var(--muted-foreground))]">
            {t('updates.currentVersion')}
          </span>
          <span className="font-mono font-medium">{APP_VERSION}</span>
        </div>

        {/* ── Check result feedback ─────────────────────────────────── */}

        {/* State: Update available */}
        {updateAvailable && latestVersion && (
          <div className="rounded-md border border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.06)] p-2.5">
            <p className="text-xs font-medium text-[hsl(var(--foreground))] mb-1.5">
              <ArrowUpRight className="inline h-3 w-3 mr-1" aria-hidden="true" />
              {tc('update.newVersion', { version: latestVersion })}
            </p>
            <div className="flex items-center gap-2">
              {releaseUrl && (
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
                >
                  {tc('update.viewRelease')}
                </a>
              )}
              {downloadUrl && (
                <>
                  <span className="text-[hsl(var(--muted-foreground)/0.3)]">|</span>
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
                  >
                    <Download className="h-2.5 w-2.5" aria-hidden="true" />
                    {tc('update.download')}
                  </a>
                </>
              )}
            </div>
          </div>
        )}

        {/* State: Up to date */}
        {isUpToDate && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {tc('update.upToDate')}
          </div>
        )}

        {/* State: Checking */}
        {checking && (
          <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {tc('update.checking')}
          </div>
        )}

        {/* Last checked timestamp */}
        {lastCheckedAt && !checking && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-[hsl(var(--muted-foreground))]">
              {t('updates.lastChecked')}
            </span>
            <span className="text-[hsl(var(--muted-foreground))]">
              {new Date(lastCheckedAt).toLocaleString()}
            </span>
          </div>
        )}

        {/* Manual check button */}
        <button
          onClick={checkForUpdates}
          disabled={checking}
          className={cn(
            'w-full rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium transition-colors',
            checking
              ? 'opacity-50 cursor-not-allowed'
              : 'hover:bg-[hsl(var(--foreground)/0.04)]',
          )}
        >
          {tc('update.checkNow')}
        </button>
      </div>
    </div>
  )
}
