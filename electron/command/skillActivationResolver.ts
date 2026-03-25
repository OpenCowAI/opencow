// SPDX-License-Identifier: Apache-2.0

import type { UserMessageContent } from '../../src/shared/types'

const MAX_IMPLICIT_QUERY_CHARS = 2_000

/**
 * Deterministically resolve explicitly activated skills from user input.
 *
 * Current rule set:
 * - Only slash skill blocks are considered explicit activation signals.
 * - Plain text heuristics are intentionally excluded to avoid false positives.
 */
export function resolveActivatedSkillNames(content: UserMessageContent): string[] {
  if (typeof content === 'string') return []

  const names = new Set<string>()
  for (const block of content) {
    if (block.type !== 'slash_command') continue
    if (block.category !== 'skill') continue
    const normalized = normalizeSkillName(block.name)
    if (normalized) names.add(normalized)
  }
  return Array.from(names)
}

/**
 * Build a normalized plain-text query for implicit skill activation matching.
 *
 * Rules:
 * - Keep only user-authored text blocks (ignore slash/image/document blocks).
 * - Collapse whitespace for deterministic matching.
 * - Cap length to avoid oversized matching inputs.
 */
export function resolveImplicitSkillActivationQuery(content: UserMessageContent): string | undefined {
  const raw = typeof content === 'string'
    ? content
    : content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

  const normalized = raw.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return undefined
  return normalized.slice(0, MAX_IMPLICIT_QUERY_CHARS)
}

function normalizeSkillName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed
}
