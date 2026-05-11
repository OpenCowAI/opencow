// SPDX-License-Identifier: Apache-2.0

/**
 * SidebarUpdateCard — Compact update notification card displayed in the
 * Sidebar below the Inbox widget when a new version is available.
 *
 * Design:
 *   - Fits the sidebar aesthetic with muted background and accent highlight
 *   - Collapsed mode: icon-only with tooltip
 *   - Expanded mode: card with version info, "View Release" link, and dismiss button
 *   - Respects per-version dismiss state via updateStore + localStorage
 */

import { useTranslation } from 'react-i18next'
import { ArrowUpRight, X, ArrowUpCircle } from 'lucide-react'
import { useUpdateStore } from '@/stores/updateStore'
import { cn } from '@/lib/utils'

export function SidebarUpdateCard({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation('common')
  const updateAvailable = useUpdateStore((s) => s.updateAvailable)
  const latestVersion = useUpdateStore((s) => s.latestVersion)
  const releaseUrl = useUpdateStore((s) => s.releaseUrl)
  const dismissedVersion = useUpdateStore((s) => s.dismissedVersion)
  const dismissUpdate = useUpdateStore((s) => s.dismissUpdate)

  // Don't render if no update or user dismissed this version
  if (!updateAvailable || !latestVersion) return null
  if (dismissedVersion === latestVersion) return null

  if (collapsed) {
    return (
      <a
        href={releaseUrl ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          'relative w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md transition-colors',
          'text-[hsl(var(--primary))] hover:bg-[hsl(var(--sidebar-primary)/0.08)]',
        )}
        aria-label={t('update.newVersion', { version: latestVersion })}
      >
        <ArrowUpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-[10px] leading-none">v{latestVersion}</span>
        {/* Pulsing dot indicator */}
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[hsl(var(--primary))] animate-pulse" />
      </a>
    )
  }

  return (
    <div
      className={cn(
        'mx-2 mt-2 rounded-lg border border-[hsl(var(--sidebar-border)/0.5)]',
        'bg-[hsl(var(--primary)/0.06)]',
        'px-3 py-2.5',
      )}
      role="status"
      aria-live="polite"
    >
      {/* Header row: icon + version + dismiss */}
      <div className="flex items-start gap-2">
        <ArrowUpCircle
          className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--primary))]"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[hsl(var(--sidebar-foreground))] leading-snug">
            {t('update.newVersion', { version: latestVersion })}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            dismissUpdate()
          }}
          className="shrink-0 p-0.5 rounded hover:bg-[hsl(var(--sidebar-foreground)/0.08)] transition-colors"
          aria-label={t('update.dismiss')}
        >
          <X className="h-3 w-3 text-[hsl(var(--muted-foreground))]" aria-hidden="true" />
        </button>
      </div>

      {/* Action link */}
      {releaseUrl && (
        <a
          href={releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--primary))] hover:underline"
        >
          {t('update.viewRelease')}
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </div>
  )
}
