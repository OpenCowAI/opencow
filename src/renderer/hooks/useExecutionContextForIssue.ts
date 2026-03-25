// SPDX-License-Identifier: Apache-2.0

import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useIssueStore } from '../stores/issueStore'
import { useCommandStore, type CommandStore } from '../stores/commandStore'
import type { SessionExecutionContext } from '@shared/types'

/**
 * Custom equality for SessionExecutionContext — prevents re-renders
 * when the context fields haven't actually changed.
 *
 * Ignores `updatedAt` (timestamp noise) — only meaningful field changes
 * should trigger a re-render.
 */
function executionContextEqual(
  a: SessionExecutionContext | null,
  b: SessionExecutionContext | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.cwd === b.cwd &&
    a.gitBranch === b.gitBranch &&
    a.isDetached === b.isDetached &&
    a.isWorktree === b.isWorktree
  )
}

/**
 * Pure selector: extracts the execution context from a commandStore snapshot.
 *
 * Takes the `issueSessionId` as an explicit parameter (resolved reactively
 * by the hook below) instead of reading issueStore as a snapshot.  See
 * `useSessionByBinding` in useSessionForIssue.ts for the rationale on why
 * cross-store snapshots inside selectors cause race conditions.
 */
function selectExecutionContext(
  commandState: CommandStore,
  issueSessionId: string | null,
  viewingArchivedSessionId: string | null,
): SessionExecutionContext | null {
  const session = viewingArchivedSessionId
    ? commandState.sessionById[viewingArchivedSessionId!]
    : issueSessionId
      ? commandState.sessionById[issueSessionId]
      : undefined

  return session?.executionContext ?? null
}

/**
 * React hook: subscribes to the store and returns the execution context
 * for the displayed session of a given issue.
 *
 * Uses `useStoreWithEqualityFn` with field-level comparison to prevent
 * re-renders during streaming (where SessionSnapshot objects change
 * frequently due to message updates, but executionContext stays the same).
 *
 * **Reactivity:** Same dual-subscription pattern as `useSessionByBinding` —
 * subscribes to `issueStore` for `issue.sessionId` (low-frequency) and to
 * `commandStore` for execution context data (high-frequency).  This avoids
 * the stale-snapshot race condition during session creation.
 */
export function useExecutionContextForIssue(
  issueId: string,
  viewingArchivedSessionId: string | null,
): SessionExecutionContext | null {
  // Reactively subscribe to issue.sessionId (same pattern as useSessionByBinding).
  const issueSessionId = useIssueStore((s) => {
    if (viewingArchivedSessionId) return null
    return s.issueDetailCache.get(issueId)?.sessionId ?? null
  })

  return useStoreWithEqualityFn(
    useCommandStore,
    (state) => selectExecutionContext(state, issueSessionId, viewingArchivedSessionId),
    executionContextEqual,
  )
}
