// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { useIssueStore } from '../stores/issueStore'
import { useCommandStore } from '../stores/commandStore'
import type { Issue, SessionSnapshot, ManagedSessionState } from '@shared/types'

// ---------------------------------------------------------------------------
// Session lifecycle constants
// ---------------------------------------------------------------------------

/** States where a session is actively running and must be stopped before archiving. */
export const ACTIVE_SESSION_STATES: ReadonlySet<ManagedSessionState> = new Set([
  'creating',
  'streaming',
  'awaiting_input',
  'awaiting_question',
])

export function isSessionActive(state: ManagedSessionState): boolean {
  return ACTIVE_SESSION_STATES.has(state)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface ArchiveOptions {
  /** When true, also clears `sessionId` to null (used by "Blank Session"). */
  clearSessionId?: boolean
}

interface UseSessionArchiveReturn {
  /**
   * Archive the current session: stop if active, move `sessionId` into
   * `sessionHistory`.
   *
   * A single atomic `updateIssue` call ensures no intermediate state where
   * `sessionId` is in neither the active slot nor the history array.
   *
   * @returns The archived session ID, or null if there was nothing to archive.
   */
  archiveCurrentSession: (
    issue: Issue,
    session: SessionSnapshot | null,
    options?: ArchiveOptions,
  ) => Promise<string | null>

  /**
   * Restore an archived session as the current one.
   *
   * 1. Stops the current session (if active).
   * 2. Removes the target from `sessionHistory`.
   * 3. Appends the current `sessionId` to `sessionHistory` (archive it).
   * 4. Sets the target as the new `sessionId`.
   *
   * All mutations are batched into a single `updateIssue` call.
   */
  restoreSession: (
    issue: Issue,
    currentSession: SessionSnapshot | null,
    targetSessionId: string,
  ) => Promise<void>
}

export function useSessionArchive(): UseSessionArchiveReturn {
  const updateIssue = useIssueStore((s) => s.updateIssue)
  const stopSession = useCommandStore((s) => s.stopSession)

  const archiveCurrentSession = useCallback(
    async (
      issue: Issue,
      session: SessionSnapshot | null,
      options?: ArchiveOptions,
    ): Promise<string | null> => {
      // Stop the session if it is currently running
      if (session && isSessionActive(session.state)) {
        await stopSession(session.id)
      }

      if (!issue.sessionId) return null

      // Atomic update: append to history (+ optionally clear sessionId)
      await updateIssue(issue.id, {
        sessionHistory: [...(issue.sessionHistory ?? []), issue.sessionId],
        ...(options?.clearSessionId ? { sessionId: null } : {}),
      })

      return issue.sessionId
    },
    [updateIssue, stopSession],
  )

  const restoreSession = useCallback(
    async (
      issue: Issue,
      currentSession: SessionSnapshot | null,
      targetSessionId: string,
    ): Promise<void> => {
      // Stop current session if active
      if (currentSession && isSessionActive(currentSession.state)) {
        await stopSession(currentSession.id)
      }

      // Build new sessionHistory:
      //   1. Remove the target (it's being restored to active)
      //   2. Append current sessionId (archive it) — only if one exists
      const currentHistory = issue.sessionHistory ?? []
      const filteredHistory = currentHistory.filter((id) => id !== targetSessionId)
      const newHistory = issue.sessionId
        ? [...filteredHistory, issue.sessionId]
        : filteredHistory

      // Single atomic update — sessionId and sessionHistory change together
      await updateIssue(issue.id, {
        sessionId: targetSessionId,
        sessionHistory: newHistory,
      })
    },
    [updateIssue, stopSession],
  )

  return { archiveCurrentSession, restoreSession }
}
