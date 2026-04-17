// SPDX-License-Identifier: Apache-2.0

import type { SessionSnapshot } from './types'
import { resolveContextLimit } from './contextLimitResolver'

/**
 * Resolved context window display state, ready for UI consumption.
 *
 * Encapsulates the multi-source resolution logic so that UI components
 * receive a single, unambiguous data structure instead of resolving raw
 * session fields inline.
 */
export interface ContextDisplayState {
  /** Current context window usage in tokens. 0 when no data is available. */
  readonly usedTokens: number
  /** Maximum context window size in tokens. Always > 0. */
  readonly limitTokens: number
  /** Whether the values are estimates vs. provider-confirmed authoritative data. */
  readonly estimated: boolean
}

/**
 * Resolve context window display state from a SessionSnapshot.
 *
 * Resolution priority:
 *
 *   **usedTokens** (per-turn context window consumption):
 *     1. `contextState.usedTokens`  — normalized runtime occupancy snapshot
 *     2. `0`                        — never fall back to legacy persisted tokens
 *
 *   **limitTokens** (maximum context window):
 *     1. `contextState.limitTokens`  — runtime authoritative limit
 *     2. `contextLimitOverride`      — provider-reported limit from turn.result (runtime cache)
 *     3. `catalog context_window`    — model catalog fallback
 *     4. Static model metadata       — last fallback
 *
 *   **estimated**:
 *     `true` when contextState is absent or has non-authoritative confidence.
 *
 * NOTE: `inputTokens` (aggregate across all turns) is intentionally NOT used
 * as a fallback for usedTokens — it is a cumulative sum that does not include
 * cache tokens, making it semantically incorrect for context window display.
 */
export function resolveContextDisplayState(session: SessionSnapshot): ContextDisplayState {
  const contextState = session.contextState ?? null

  // usedTokens: only normalized runtime occupancy is valid.
  const usedTokens = contextState?.usedTokens ?? 0

  const limitResolution = resolveContextLimit({
    model: session.model,
    contextState,
    contextLimitOverride: session.contextLimitOverride,
  })
  const limitTokens = limitResolution.limitTokens

  // estimated: authoritative only when contextState explicitly says so
  const estimated = contextState
    ? contextState.confidence !== 'authoritative'
    : true

  return { usedTokens, limitTokens, estimated }
}
