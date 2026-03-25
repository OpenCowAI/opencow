// SPDX-License-Identifier: Apache-2.0

import { memo, useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { surfaceProps } from '@/lib/surface'
import { useExitAnimation } from '@/hooks/useModalAnimation'
import { IssueDetailView } from '../DetailPanel/IssueDetailView'

// ─── IssuePreviewOverlay ────────────────────────────────────────────────────

interface IssuePreviewOverlayProps {
  /** The initial issue to display. */
  issueId: string
  /** Called when the panel should close (ESC or IssueDetailView X). */
  onClose: () => void
}

/**
 * Right-aligned floating side-panel that renders `IssueDetailView`,
 * allowing the user to preview an issue without navigating away from
 * the Starred Artifacts page. No backdrop — the panel simply slides
 * in over the right edge.
 *
 * Supports in-panel navigation: clicking a sub-issue or parent-issue
 * link updates the displayed issue without closing the panel.
 */
export const IssuePreviewOverlay = memo(function IssuePreviewOverlay({
  issueId,
  onClose,
}: IssuePreviewOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation('schedule')
  const { phase, requestClose } = useExitAnimation(onClose)

  // Internal navigation state — allows sub-issue / parent-issue traversal within the panel
  const [currentIssueId, setCurrentIssueId] = useState(issueId)

  // Keep in sync if the parent changes the issueId prop
  useEffect(() => {
    setCurrentIssueId(issueId)
  }, [issueId])

  const panelRef = useRef<HTMLDivElement>(null)

  // Focus the panel on mount so ESC works immediately
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // ESC key to close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose()
      }
    },
    [requestClose],
  )

  // Click outside the panel → close
  const handleOutsideClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) requestClose()
    },
    [requestClose],
  )

  // Navigate to a different issue within the panel
  const handleNavigateToIssue = useCallback((id: string) => {
    setCurrentIssueId(id)
  }, [])

  return createPortal(
    /* Transparent hit-area covers the screen so clicking outside closes the panel */
    <div
      className="fixed inset-0 z-[100] overscroll-contain no-drag"
      onClick={handleOutsideClick}
    >
      {/* Side panel — right-aligned, similar width to DetailPanel (~45%) */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t('starred.issuePreviewAria')}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        {...surfaceProps({ elevation: 'modal', color: 'card' })}
        className={cn(
          'absolute top-3 bottom-3 right-3 flex flex-col w-[45%] min-w-[420px] max-w-[70%]',
          'rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl outline-none overflow-hidden',
          phase === 'enter' && 'side-panel-enter',
          phase === 'exit' && 'side-panel-exit',
        )}
      >
        <IssueDetailView
          issueId={currentIssueId}
          onClose={requestClose}
          onNavigateToIssue={handleNavigateToIssue}
        />
      </div>
    </div>,
    document.body,
  )
})
