// SPDX-License-Identifier: Apache-2.0

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAppStore, selectMainTab } from '@/stores/appStore'

/**
 * ProviderBanner — Shown at the top of MainPanel when the default AI engine
 * is not authenticated. Dismissible per session (reappears on next app launch
 * if still not configured).
 *
 * Covers two scenarios:
 *   1. User skipped Provider setup during onboarding
 *   2. Previously configured credentials expired or were removed
 *
 * Hides itself when:
 *   - Onboarding is not yet completed
 *   - The default engine is authenticated
 *   - The user dismissed the banner
 *   - The schedule full-panel view is active (no tab bar visible)
 */
export function ProviderBanner(): React.JSX.Element | null {
  const { t } = useTranslation('navigation')
  const [dismissed, setDismissed] = useState(false)

  const settings = useSettingsStore((s) => s.settings)
  const providerStatusByEngine = useSettingsStore((s) => s.providerStatusByEngine)
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal)
  const onboarding = useAppStore((s) => s.onboarding)
  const activeTab = useAppStore(selectMainTab)

  const handleConfigure = useCallback(() => {
    openSettingsModal('provider')
  }, [openSettingsModal])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  // Don't show during onboarding
  if (!onboarding.completed) return null

  // Don't show during full-panel schedule view (no tab bar = no banner)
  if (activeTab === 'schedule') return null

  // Determine if the default engine is authenticated
  const defaultEngine = settings?.command.defaultEngine ?? 'claude'
  const status = providerStatusByEngine[defaultEngine]
  const isAuthenticated = status?.state === 'authenticated'

  // Don't show if authenticated or manually dismissed
  if (isAuthenticated || dismissed) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-b px-3 py-2',
        'border-amber-500/20 bg-amber-500/5',
      )}
      role="alert"
    >
      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-xs text-amber-600 dark:text-amber-400">
        {t('providerBanner.message')}
      </p>
      <button
        type="button"
        onClick={handleConfigure}
        className={cn(
          'shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          'bg-amber-500/15 text-amber-600 dark:text-amber-400',
          'hover:bg-amber-500/25',
        )}
      >
        {t('providerBanner.configure')}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded-md p-1 text-amber-500/60 hover:text-amber-500 transition-colors"
        aria-label={t('providerBanner.dismiss')}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
