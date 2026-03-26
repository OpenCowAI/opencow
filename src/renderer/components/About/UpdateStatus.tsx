// SPDX-License-Identifier: Apache-2.0

/**
 * UpdateStatus — Inline update status block rendered inside AboutDialog.
 *
 * Three visual states:
 *   1. Checking — spinner with "Checking for updates..."
 *   2. Up to date — green check with last-checked timestamp
 *   3. Update available — highlighted card with version + action buttons
 */

import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { Check, ArrowUpRight, Download, Loader2 } from 'lucide-react'
import { useUpdateStore } from '@/stores/updateStore'

export function UpdateStatus(): React.JSX.Element {
  const { t } = useTranslation('common')
  const updateAvailable = useUpdateStore((s) => s.updateAvailable)
  const latestVersion = useUpdateStore((s) => s.latestVersion)
  const releaseUrl = useUpdateStore((s) => s.releaseUrl)
  const downloadUrl = useUpdateStore((s) => s.downloadUrl)
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt)
  const checking = useUpdateStore((s) => s.checking)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)

  // State: Checking
  if (checking) {
    return (
      <div className="flex flex-col items-center gap-1 mt-2">
        <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {t('update.checking')}
        </div>
      </div>
    )
  }

  // State: Update available
  if (updateAvailable && latestVersion) {
    return (
      <div className="mt-2 w-full max-w-[260px]">
        <div className="rounded-lg border border-[hsl(var(--primary)/0.3)] bg-[hsl(var(--primary)/0.06)] p-3">
          <p className="text-xs font-medium text-[hsl(var(--foreground))] mb-2">
            <ArrowUpRight className="inline h-3 w-3 mr-1" aria-hidden="true" />
            {t('update.newVersion', { version: latestVersion })}
          </p>
          <div className="flex items-center gap-2">
            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
              >
                {t('update.viewRelease')}
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
                  {t('update.download')}
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // State: Up to date
  return (
    <div className="flex flex-col items-center gap-1 mt-2">
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" aria-hidden="true" />
        {t('update.upToDate')}
      </div>
      {lastCheckedAt && (
        <p className="text-[10px] text-[hsl(var(--muted-foreground)/0.6)]">
          {t('update.lastChecked', { time: formatRelativeTime(lastCheckedAt, t) })}
        </p>
      )}
      <button
        onClick={checkForUpdates}
        className="mt-1 text-[10px] text-[hsl(var(--primary))] hover:underline"
      >
        {t('update.checkNow')}
      </button>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Format an ISO 8601 timestamp as a locale-aware relative time string.
 * Uses i18n keys instead of hardcoded English so the output adapts
 * to the user's selected language.
 */
function formatRelativeTime(isoString: string, t: TFunction): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('update.timeJustNow')
  if (minutes < 60) return t('update.timeMinutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('update.timeHoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('update.timeDaysAgo', { count: days })
}
