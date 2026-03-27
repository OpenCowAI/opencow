// SPDX-License-Identifier: Apache-2.0

import type { MemorySource, MemoryCategory, MemoryScope } from '@shared/types'

/**
 * Standardized interaction event from any source adapter.
 */
export interface InteractionEvent {
  type: MemorySource
  projectId: string | null
  sessionId: string | null
  content: string
  metadata: {
    projectName?: string
    stopReason?: string
    originSource?: string
    [key: string]: unknown
  }
  timestamp: number
}

/**
 * Action the LLM decided for a candidate memory.
 * - `new`: entirely new memory, no existing memory covers this topic
 * - `update`: merges richer information into an existing memory (targetId)
 */
export type CandidateAction = { type: 'new' } | { type: 'update'; targetId: string }

/**
 * Raw candidate returned by LLM extraction (before quality gate).
 */
export interface CandidateMemory {
  content: string
  category: MemoryCategory
  scope: MemoryScope
  confidence: number
  tags: string[]
  reasoning: string
  action: CandidateAction
}

/**
 * Adapter for converting DataBus events into InteractionEvents.
 */
export interface InteractionSourceAdapter {
  sourceType: MemorySource
  shouldProcess(eventType: string, data: Record<string, unknown>): boolean
  toInteractionEvent(eventType: string, data: Record<string, unknown>): InteractionEvent | null
}
