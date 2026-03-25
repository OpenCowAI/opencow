// SPDX-License-Identifier: Apache-2.0

import type { SessionSnapshot } from './types'
import { getContextLimit } from './modelContextLimits'

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
 *     1. `contextState.usedTokens`  — runtime per-turn data from turn.usage or context.snapshot
 *     2. `lastInputTokens`          — DB-persisted value (survives process restart)
 *
 *   **limitTokens** (maximum context window):
 *     1. `contextState.limitTokens`  — provider-reported dynamic limit (runtime)
 *     2. `contextLimitOverride`      — provider-reported limit from turn.result (runtime cache)
 *     3. Static model metadata       — via getContextLimit() (fallback)
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

  // usedTokens: prefer runtime state, fall back to DB-persisted value
  const usedTokens = contextState?.usedTokens ?? session.lastInputTokens

  // limitTokens: three-tier fallback
  //   1. contextState.limitTokens   — authoritative runtime value
  //   2. contextLimitOverride       — provider-reported dynamic limit from turn.result
  //   3. static model metadata      — hardcoded per engine/model defaults
  const dynamicLimit =
    session.contextLimitOverride != null && session.contextLimitOverride > 0
      ? session.contextLimitOverride
      : null
  const staticLimit = getContextLimit({
    engineKind: session.engineKind,
    model: session.model,
  })
  const limitTokens = contextState?.limitTokens ?? dynamicLimit ?? staticLimit

  // estimated: authoritative only when contextState explicitly says so
  const estimated = contextState
    ? contextState.confidence !== 'authoritative'
    : true

  return { usedTokens, limitTokens, estimated }
}
