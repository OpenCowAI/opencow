// SPDX-License-Identifier: Apache-2.0

/**
 * Shared config panel skeleton for IM platforms.
 *
 * Provides the common layout:
 *   Credential fields (via children) → [afterCredentials slot] →
 *   Advanced Options (collapsed) → Allowed User IDs → Workspace Path Picker.
 *
 * Each platform panel supplies only its credential-specific fields through the
 * render-prop `children`, keeping platform panels to ~15 lines each.
 *
 * The optional `afterCredentials` slot sits between credential fields and
 * advanced options — used for test-connection buttons, runtime stats, or
 * setup guides that are platform-specific but common enough to standardize.
 */

import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { IMConnection } from '@shared/types'
import { TextField } from './fields'
import { WorkspacePathPicker } from './WorkspacePathPicker'

// ── Generic config panel ─────────────────────────────────────────────────────

interface GenericConfigPanelProps<C extends IMConnection> {
  connection: C
  onUpdate: (updated: C) => void
  /** Render platform-specific credential fields. Receives a `patch` helper. */
  children: (patch: (partial: Partial<C>) => void) => React.ReactNode
  /**
   * Optional content rendered between credential fields and advanced options.
   * Typically used for test-connection buttons, runtime stats, or setup guides.
   */
  afterCredentials?: React.ReactNode
}

export function GenericConfigPanel<C extends IMConnection>({
  connection,
  onUpdate,
  children,
  afterCredentials,
}: GenericConfigPanelProps<C>): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const patch = useCallback(
    (partial: Partial<C>) => onUpdate({ ...connection, ...partial }),
    [connection, onUpdate],
  )

  const handleAllowedUserIdsChange = useCallback(
    (raw: string) => {
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean)
      patch({ allowedUserIds: ids } as Partial<C>)
    },
    [patch],
  )

  return (
    <div className="space-y-4">
      {/* Platform-specific credential fields */}
      {children(patch)}

      {/* Optional slot: test connection, stats, setup guide, etc. */}
      {afterCredentials}

      {/* Advanced options — collapsed by default */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors py-1"
        >
          {showAdvanced
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />
          }
          {t('messaging.advancedOptions')}
        </button>

        {showAdvanced && (
          <div className="space-y-4 mt-3 animate-in fade-in slide-in-from-top-1 duration-150">
            <TextField
              label={t('messaging.allowedUserIds')}
              value={connection.allowedUserIds.join(', ')}
              placeholder={t('messaging.allowedUserIdsPlaceholder')}
              onChange={handleAllowedUserIdsChange}
            />

            <WorkspacePathPicker
              workspace={connection.defaultWorkspace}
              onChange={(defaultWorkspace) => patch({ defaultWorkspace } as Partial<C>)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
