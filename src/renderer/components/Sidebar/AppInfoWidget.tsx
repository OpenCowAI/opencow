// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/lib/utils'
import { APP_NAME, APP_VERSION } from '@shared/appIdentity'
import { Tooltip } from '@/components/ui/Tooltip'

// ---------------------------------------------------------------------------
// AppInfoWidget
// ---------------------------------------------------------------------------

/**
 * Sidebar footer widget — single button that opens the Settings modal.
 *
 * Collapsed mode: a single gear icon button.
 * Expanded mode:  [⚙️ OpenCow  v0.3.0] as a horizontal bar.
 */
export function AppInfoWidget({ collapsed = false }: { collapsed?: boolean }): React.JSX.Element {
  const { t } = useTranslation('common')
  const openSettingsModal = useSettingsStore((s) => s.openSettingsModal)

  if (collapsed) {
    return (
      <div className="w-full border-t border-[hsl(var(--sidebar-border)/0.35)] py-1.5 flex justify-center">
        <Tooltip content={t('openSettings')} position="right" align="center">
          <button
            onClick={() => openSettingsModal()}
            className={cn(
              'h-8 w-8 flex items-center justify-center rounded-md transition-colors',
              'text-[hsl(var(--sidebar-foreground)/0.86)] hover:text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]',
            )}
            aria-label={t('openSettings')}
            title={t('openSettings')}
          >
            <Settings className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <button
      onClick={() => openSettingsModal()}
      className="w-full flex items-center gap-2 border-t border-[hsl(var(--sidebar-border)/0.35)] px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-foreground))] transition-colors"
      aria-label={t('openSettings')}
    >
      <Settings className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{APP_NAME}</span>
      <span className="ml-auto text-[10px] leading-none opacity-60">v{APP_VERSION}</span>
    </button>
  )
}
