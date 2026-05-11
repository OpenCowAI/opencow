// SPDX-License-Identifier: Apache-2.0

import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DetailPreviewOverlay } from '@/components/ui/DetailPreviewOverlay'
import { IssueDetailView } from '../DetailPanel/IssueDetailView'

// ─── IssuePreviewOverlay ────────────────────────────────────────────────────

interface IssuePreviewOverlayProps {
  /** The issue to display.  Updates swap the panel content without remount. */
  issueId: string
  /** Called when the panel should close (ESC, X, or non-modal outside-click). */
  onClose: () => void
  /**
   * Modal behavior — see `DetailPreviewOverlay` docs.  Defaults to `true`
   * to preserve the original Starred Artifacts dismiss-on-backdrop
   * behavior.  Project Issues list overrides to `false`.
   */
  modal?: boolean
  /**
   * Optional navigation handler.  When provided, sub-issue / parent-issue
   * links inside the panel delegate to this callback instead of mutating
   * the panel's local state — letting the parent keep its own selection
   * (e.g. row highlight) in sync with the displayed issue.
   *
   * When omitted, the panel manages navigation internally (Starred-
   * artifacts behavior — no store pollution).
   */
  onNavigateToIssue?: (id: string) => void
}

/**
 * Issue-detail flavor of the shared `DetailPreviewOverlay`.  Adds the
 * one issue-specific concern that doesn't belong in the generic shell:
 * a local `internalIssueId` that lets the panel handle in-place sub-
 * issue / parent-issue navigation without leaking into the store when
 * the caller hasn't opted into delegated navigation.
 */
export const IssuePreviewOverlay = memo(function IssuePreviewOverlay({
  issueId,
  onClose,
  modal = true,
  onNavigateToIssue,
}: IssuePreviewOverlayProps): React.JSX.Element {
  const { t } = useTranslation('schedule')

  // Internal navigation state — only used when the parent does NOT
  // supply `onNavigateToIssue`.  When the parent owns navigation
  // (e.g. the Issues list), `issueId` is the single source of truth and
  // we bypass this state to keep behavior 1:1 with parent selection.
  const [internalIssueId, setInternalIssueId] = useState(issueId)
  useEffect(() => {
    setInternalIssueId(issueId)
  }, [issueId])

  const currentIssueId = onNavigateToIssue ? issueId : internalIssueId
  const handleNavigateToIssue = onNavigateToIssue ?? setInternalIssueId

  return (
    <DetailPreviewOverlay
      onClose={onClose}
      modal={modal}
      ariaLabel={t('starred.issuePreviewAria')}
      swapTargetSelector="[data-issue-row]"
    >
      {(requestClose) => (
        <IssueDetailView
          issueId={currentIssueId}
          onClose={requestClose}
          onNavigateToIssue={handleNavigateToIssue}
        />
      )}
    </DetailPreviewOverlay>
  )
})
