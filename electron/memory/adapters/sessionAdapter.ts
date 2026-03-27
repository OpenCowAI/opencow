// SPDX-License-Identifier: Apache-2.0

import type { InteractionSourceAdapter, InteractionEvent } from '../types'
import { MAX_SESSION_CONTENT_LENGTH } from '../constants'

/**
 * Converts session idle/stopped events into InteractionEvents.
 *
 * Does NOT require `result` in the event payload (it's rarely populated).
 * Instead, the MemoryService resolves session content via getSessionContent().
 * This adapter only gates on event type + stop reason.
 */
export class SessionInteractionAdapter implements InteractionSourceAdapter {
  sourceType = 'session' as const

  shouldProcess(eventType: string, data: Record<string, unknown>): boolean {
    if (eventType !== 'command:session:idle' && eventType !== 'command:session:stopped') {
      return false
    }

    // Only process sessions that completed or idled normally
    const stopReason = data.stopReason as string | undefined
    if (stopReason === 'error' || stopReason === 'cancelled') return false

    // Must have a sessionId
    if (!data.sessionId) return false

    return true
  }

  toInteractionEvent(eventType: string, data: Record<string, unknown>): InteractionEvent | null {
    const sessionId = data.sessionId as string | undefined
    const origin = data.origin as Record<string, unknown> | undefined

    if (!sessionId) return null

    // Content will be resolved later by MemoryService via getSessionContent()
    // We use a placeholder here — the service will replace it
    return {
      type: 'session',
      projectId: (origin?.projectId as string) ?? null,
      sessionId,
      content: '', // placeholder — resolved by MemoryService
      metadata: {
        stopReason: typeof data.stopReason === 'string' ? data.stopReason : undefined,
        originSource: typeof origin?.source === 'string' ? origin.source : undefined,
        projectName: typeof origin?.projectName === 'string' ? origin.projectName : undefined,
      },
      timestamp: Date.now(),
    }
  }
}
