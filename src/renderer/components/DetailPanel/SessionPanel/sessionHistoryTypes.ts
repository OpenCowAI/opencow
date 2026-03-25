// SPDX-License-Identifier: Apache-2.0

import type { SessionSnapshot } from '@shared/types'

/**
 * Session history context — groups archived-session data, actions, and
 * viewing state into a single structured prop.
 *
 * Passed from the orchestrator (IssueDetailView) through SessionPanel
 * to SessionStatusBar / SessionHistoryDropdown.
 */
export interface SessionHistoryContext {
  /** Archived sessions in chronological order (oldest first). */
  archivedSessions: SessionSnapshot[]
  /** Restore an archived session as the current one. */
  onRestore: (sessionId: string) => void
  /** View an archived session in read-only mode. */
  onView: (sessionId: string) => void
  /** Whether the panel is currently showing an archived session (read-only). */
  isViewingArchived: boolean
  /** Exit read-only archived view, returning to the current session. */
  onExitView: () => void
}
