// SPDX-License-Identifier: Apache-2.0

/**
 * useSessionMessages — Unified hook for session message access.
 *
 * Combines two concerns into a single call:
 *   1. **Lazy-load**: Ensures persisted messages are fetched via IPC on first
 *      access (cold-start path for completed/idle sessions after app restart).
 *   2. **Subscribe**: Returns a reactive `ManagedSessionMessage[]` that updates
 *      in real time when the session streams new content.
 *
 * Usage:
 * ```ts
 * const messages = useSessionMessages(sessionId)
 * ```
 *
 * Replaces the previous two-step pattern:
 * ```ts
 * // BEFORE (scattered across 6+ components):
 * useEffect(() => {
 *   useCommandStore.getState().ensureSessionMessages(sessionId)
 * }, [sessionId])
 * const messages = useCommandStore((s) => selectSessionMessages(s, sessionId))
 *
 * // AFTER:
 * const messages = useSessionMessages(sessionId)
 * ```
 */

import { useEffect } from 'react'
import { useCommandStore, selectSessionMessages } from '@/stores/commandStore'
import type { ManagedSessionMessage } from '@shared/types'

export function useSessionMessages(sessionId: string | null): ManagedSessionMessage[] {
  // Trigger lazy-load on mount / sessionId change.
  // Uses getState() (imperative) to avoid extra subscription overhead.
  useEffect(() => {
    if (!sessionId) return
    useCommandStore.getState().ensureSessionMessages(sessionId)
  }, [sessionId])

  // Subscribe to real-time message updates.
  return useCommandStore((s) => selectSessionMessages(s, sessionId))
}
