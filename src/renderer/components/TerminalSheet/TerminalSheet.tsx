// SPDX-License-Identifier: Apache-2.0

/**
 * TerminalPanel — Embedded terminal panel.
 *
 * Serves as the bottom half of the AppLayout vertical split,
 * controlled via CSS flex + native drag for expand/collapse.
 * Content area pushes upward while the terminal occupies the bottom space.
 *
 * No fixed positioning, no z-index.
 */

import { useEffect } from 'react'
import { useAppStore, selectProjectId } from '@/stores/appStore'
import { useTerminalOverlayStore } from '@/stores/terminalOverlayStore'
import { TerminalSheetToolbar } from './TerminalSheetToolbar'
import { XTermContainer } from './XTermContainer'
import type { TerminalOverlayState, TerminalScope } from '@shared/types'

export function TerminalPanel(): React.JSX.Element | null {
  const overlay = useTerminalOverlayStore((s) => s.terminalOverlay)
  if (!overlay) return null

  return <TerminalPanelContent overlay={overlay} />
}

function TerminalPanelContent({ overlay }: {
  overlay: TerminalOverlayState
}): React.JSX.Element {
  const closeTerminalOverlay = useTerminalOverlayStore((s) => s.closeTerminalOverlay)
  const currentProjectId = useAppStore(selectProjectId)
  const switchTerminalScope = useTerminalOverlayStore((s) => s.switchTerminalScope)
  const isExiting = useTerminalOverlayStore((s) => s._terminalExiting)

  // Derived state
  const scopeKey = overlay.scope.type === 'global'
    ? 'global'
    : `project:${overlay.scope.projectId}`
  const tabGroup = useTerminalOverlayStore((s) => s.terminalTabGroups[scopeKey])
  const activeTerminalId = tabGroup?.activeTabId ?? null

  // ── Auto-sync terminal scope when the active project changes ──
  useEffect(() => {
    const overlayProjectId = overlay.scope.type === 'project'
      ? overlay.scope.projectId
      : null

    if (overlayProjectId === currentProjectId) return // already in sync

    const newScope: TerminalScope = currentProjectId
      ? { type: 'project', projectId: currentProjectId }
      : { type: 'global' }

    switchTerminalScope(newScope)
  }, [currentProjectId, overlay.scope, switchTerminalScope])

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--background))]">
      <TerminalSheetToolbar
        scope={overlay.scope}
        scopeKey={scopeKey}
        onClose={closeTerminalOverlay}
      />
      <div className="flex-1 min-h-0">
        {!isExiting && (
          <XTermContainer
            key={activeTerminalId ?? scopeKey}
            scope={overlay.scope}
            terminalId={activeTerminalId}
          />
        )}
      </div>
    </div>
  )
}
