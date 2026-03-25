// SPDX-License-Identifier: Apache-2.0

/**
 * Conservative token estimator for mixed Chinese/English content.
 *
 * Accuracy: ±30% — adequate for context budget enforcement.
 * Formula:
 *   - CJK characters (U+4E00–U+9FFF, CJK Extension A/B, etc.): 1.5 chars/token
 *   - ASCII / Latin: 4 chars/token
 *
 * This is intentionally conservative to prevent context window overflow.
 * A future improvement would replace this with js-tiktoken for exact counts.
 */

import { snapToGraphemeBoundary } from '@shared/unicode'

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g

export function estimateTokens(text: string): number {
  const cjkMatches = text.match(CJK_REGEX)
  const cjkChars = cjkMatches?.length ?? 0
  const asciiChars = text.length - cjkChars

  // CJK: ceil(chars / 1.5) ≈ chars * 0.67
  // ASCII: ceil(chars / 4) = chars * 0.25
  return Math.ceil(cjkChars * 0.67 + asciiChars * 0.25)
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text

  // Binary search for the right character cut-off
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  const safeCut = snapToGraphemeBoundary(text, lo)
  return text.slice(0, safeCut) + '\n[Content truncated]'
}
