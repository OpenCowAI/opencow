// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { APP_NAME, APP_VERSION } from '@shared/appIdentity'

// ---------------------------------------------------------------------------
// AppInfoWidget
// ---------------------------------------------------------------------------

/**
 * Sidebar footer widget — single button that opens the Settings modal.
 *
 * Collapsed mode: icon-on-top with label below (matches the other collapsed
 * sidebar entries).
 * Expanded mode:  [⚙️ OpenCow  v0.3.0] as a horizontal bar.
 */
export function AppInfoWidget({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('common')
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal)

  if (collapsed) {
    return (
      <button
        onClick={() => openSettingsModal()}
        className={cn(
          'w-full flex flex-col items-center justify-center gap-1 py-2 rounded-md mx-auto transition-colors',
          'text-[hsl(var(--sidebar-foreground)/0.86)] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.05)]',
        )}
        aria-label={t('openSettings')}
      >
        <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="text-[10px] leading-none">{t('settings')}</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => openSettingsModal()}
      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--sidebar-primary)/0.05)] hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
      aria-label={t('openSettings')}
    >
      <Settings className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{APP_NAME}</span>
      <span className="ml-auto text-[10px] leading-none opacity-60">v{APP_VERSION}</span>
    </button>
  )
}
