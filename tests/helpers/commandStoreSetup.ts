// SPDX-License-Identifier: Apache-2.0

/**
 * Test helpers for commandStore setup and teardown.
 *
 * Centralizes the 3-field normalization pattern (managedSessions +
 * sessionById + sessionMessages) that every test touching session data
 * must configure.
 *
 * Keeps test files focused on behavior rather than store plumbing.
 */

import { useCommandStore } from '../../src/renderer/stores/commandStore'
import type { ManagedSessionInfo } from '../../src/shared/types'

/**
 * Reset commandStore to empty state.
 *
 * Call in `beforeEach` to guarantee isolation between tests.
 */
export function resetCommandStore(): void {
  useCommandStore.getState().reset()
}

/**
 * Populate commandStore with the given sessions, maintaining both the
 * ordered array and normalized index atomically.
 *
 * Also seeds `sessionMessages` from each session's `messages` array
 * (mirrors `setManagedSessions` production behavior).
 */
export function setCommandStoreSessions(sessions: ManagedSessionInfo[]): void {
  const sessionById: Record<string, ManagedSessionInfo> = {}
  const sessionMessages: Record<string, ManagedSessionInfo['messages']> = {}

  for (const s of sessions) {
    sessionById[s.id] = s
    if (s.messages.length > 0) {
      sessionMessages[s.id] = s.messages
    }
  }

  useCommandStore.setState({
    managedSessions: sessions,
    sessionById,
    sessionMessages,
    streamingMessageBySession: {},
    latestTodosBySession: {},
    activeManagedSessionId: null,
  })
}
