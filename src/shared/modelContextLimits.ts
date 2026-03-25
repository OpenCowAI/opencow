// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind } from './types'

/**
 * Known context window limits (in tokens), keyed by engine and model prefix.
 * Used to compute context window usage percentage in SessionStatusBar.
 *
 * Notes:
 * - Matching is by prefix/contains because providers may append build suffixes.
 * - For Codex models, limits are conservative defaults until the runtime surfaces
 *   authoritative per-model context metadata.
 */
const MODEL_CONTEXT_LIMITS: Record<AIEngineKind, Array<[prefix: string, limit: number]>> = {
  claude: [
    // Claude 4 family
    ['claude-opus-4', 200_000],
    ['claude-sonnet-4', 200_000],
    // Claude 3.5 family
    ['claude-3-5-haiku', 200_000],
    ['claude-3-5-sonnet', 200_000],
    // Claude 3 family
    ['claude-3-opus', 200_000],
    ['claude-3-sonnet', 200_000],
    ['claude-3-haiku', 200_000],
  ],
  codex: [
    // Conservative explicit mapping for common Codex model aliases.
    ['gpt-5.3-codex', 200_000],
    ['gpt-5.2-codex', 200_000],
    ['gpt-5.1-codex-max', 200_000],
    ['gpt-5-codex', 200_000],
    ['codex-mini-latest', 200_000],
  ],
}

/** Default context window size per engine when model is unknown. */
export const DEFAULT_CONTEXT_LIMIT_BY_ENGINE: Record<AIEngineKind, number> = {
  claude: 200_000,
  codex: 200_000,
}

/**
 * Resolve context window limit by engine + model.
 * Matches by prefix — e.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4".
 */
export function getContextLimit(params: {
  engineKind: AIEngineKind
  model: string | null
}): number {
  const { engineKind, model } = params
  if (!model) return DEFAULT_CONTEXT_LIMIT_BY_ENGINE[engineKind]
  const normalized = model.toLowerCase()
  for (const [prefix, limit] of MODEL_CONTEXT_LIMITS[engineKind]) {
    if (normalized.startsWith(prefix) || normalized.includes(prefix)) {
      return limit
    }
  }
  return DEFAULT_CONTEXT_LIMIT_BY_ENGINE[engineKind]
}
