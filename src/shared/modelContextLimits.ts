// SPDX-License-Identifier: Apache-2.0

/**
 * Known context window limits (in tokens), keyed by model prefix.
 * Used to compute context window usage percentage in SessionStatusBar.
 *
 * Notes:
 * - Matching is by prefix/contains because providers may append build suffixes.
 */
const MODEL_CONTEXT_LIMITS: Array<[prefix: string, limit: number]> = [
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
]

/** Default context window size when model is unknown. */
export const DEFAULT_CONTEXT_LIMIT = 200_000

/**
 * Resolve context window limit by model.
 * Matches by prefix — e.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4".
 */
export function getContextLimit(params: {
  model: string | null
}): number {
  const { model } = params
  if (!model) return DEFAULT_CONTEXT_LIMIT
  const normalized = model.toLowerCase()
  for (const [prefix, limit] of MODEL_CONTEXT_LIMITS) {
    if (normalized.startsWith(prefix) || normalized.includes(prefix)) {
      return limit
    }
  }
  return DEFAULT_CONTEXT_LIMIT
}
