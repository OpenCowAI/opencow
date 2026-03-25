// SPDX-License-Identifier: Apache-2.0

/**
 * commandActions — Cross-store coordination for agent session lifecycle.
 *
 * Wraps commandStore operations that require side effects in other stores:
 *   - startSession: links the new session to its origin issue (appStore.updateIssue)
 *   - deleteSession: clears agentChatSessionId in appStore when the deleted
 *     session was the active chat session
 */

import { useCommandStore } from '@/stores/commandStore'
import { useAppStore } from '@/stores/appStore'
import { useIssueStore } from '@/stores/issueStore'
import type { StartSessionInput } from '@shared/types'
import { getOriginIssueId } from '@shared/types'

/**
 * Start a new agent session and link it to the origin issue (if any).
 *
 * NOTE: Issue status is NOT updated here. The sessionId is returned before
 * the SDK process has actually spawned, so the session may still fail
 * (e.g. spawn EBADF). Status is updated to 'in_progress' only after the
 * session successfully initialises — see useAppBootstrap 'command:session:updated'.
 */
export async function startSession(input: StartSessionInput): Promise<string> {
  const sessionId = await useCommandStore.getState().startSessionRaw(input)

  if (sessionId && input.origin) {
    const issueId = getOriginIssueId(input.origin)
    if (issueId) {
      await useIssueStore.getState().updateIssue(issueId, { sessionId })
    }
  }

  return sessionId
}

/**
 * Delete an agent session with cross-store cleanup.
 *
 * In addition to removing the session from commandStore, this clears
 * `agentChatSessionId` in appStore when the deleted session was the
 * active chat conversation — preventing the Chat tab from referencing
 * a non-existent session.
 *
 * NOTE: Additional cleanup (e.g. closing browser overlay) is handled by
 * the `command:session:deleted` DataBus event in useAppBootstrap.  Only
 * `agentChatSessionId` is cleared eagerly here because the Chat tab is
 * always visible and would show a broken reference during the ~5-10ms
 * IPC round-trip.  The DataBus handler provides the authoritative
 * catch-all cleanup for ALL deletion paths (user-initiated + backend-
 * initiated), so this function intentionally does not duplicate every
 * cleanup step.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const result = await useCommandStore.getState().deleteSessionRaw(sessionId)

  if (result) {
    const appState = useAppStore.getState()
    if (appState.agentChatSessionId === sessionId) {
      useAppStore.setState({ agentChatSessionId: null })
    }
  }

  return result
}
