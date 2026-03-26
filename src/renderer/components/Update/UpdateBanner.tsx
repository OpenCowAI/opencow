// SPDX-License-Identifier: Apache-2.0

/**
 * UpdateBanner — Global notification bar shown at the top of the window
 * when a new OpenCow version is available on GitHub Releases.
 *
 * Design:
 *   - 36px compact bar with a left accent border
 *   - Shows version, "View Release" link, and dismiss button
 *   - Slide-down/slide-up animation on mount/unmount
 *   - Persists dismiss state per version (via updateStore + localStorage)
 *   - Does not show when user has dismissed the current latest version
 *
 * Mounted at root level in App.tsx, above the main layout.
 */

import { useTranslation } from 'react-i18next'
import { ArrowUpRight, X } from 'lucide-react'
import { useUpdateStore } from '@/stores/updateStore'
import { APP_NAME } from '@shared/appIdentity'

// NOTE: APP_NAME is passed as an interpolation variable to i18n templates
// so translators can reposition the brand name freely per locale.

export function UpdateBanner(): React.JSX.Element | null {
  const { t } = useTranslation('common')
  const updateAvailable = useUpdateStore((s) => s.updateAvailable)
  const latestVersion = useUpdateStore((s) => s.latestVersion)
  const releaseUrl = useUpdateStore((s) => s.releaseUrl)
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion)
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate)

  // Don't render if no update or user dismissed this version
  if (!updateAvailable || !latestVersion) return null
  if (dismissedVersion === latestVersion) return null

  return (
    <div
      className="flex items-center justify-center gap-3 px-4 h-9 shrink-0
        border-b border-[hsl(var(--border))]
        bg-[hsl(var(--primary)/0.06)]
        border-l-[3px] border-l-[hsl(var(--primary))]
        animate-in slide-in-from-top duration-200"
      role="status"
      aria-live="polite"
    >
      <p className="text-xs text-[hsl(var(--foreground))] font-medium">
        {t('update.available', { name: APP_NAME, version: latestVersion })}
      </p>

      {releaseUrl && (
        <a
          href={releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium
            text-[hsl(var(--primary))] hover:underline"
        >
          {t('update.viewRelease')}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      )}

      <button
        onClick={dismissUpdate}
        className="ml-auto p-0.5 rounded hover:bg-[hsl(var(--foreground)/0.06)] transition-colors"
        aria-label={t('update.dismiss')}
      >
        <X className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
      </button>
    </div>
  )
}
