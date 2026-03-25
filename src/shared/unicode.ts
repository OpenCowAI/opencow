// SPDX-License-Identifier: Apache-2.0

/**
 * Unicode-safe text utilities.
 *
 * JavaScript strings are UTF-16 encoded. `String.prototype.length` and
 * `.slice()` operate on **code units**, not user-perceived characters.
 * When a truncation point falls inside a surrogate pair (emoji, CJK-B, etc.),
 * the result contains a lone surrogate that renders as U+FFFD (�).
 *
 * This module provides safe alternatives that operate on **grapheme clusters**
 * — the smallest user-perceived "characters" — using `Intl.Segmenter`.
 *
 * @example
 * // Dangerous:
 * '👨‍👩‍👧‍👦 hello'.slice(0, 3)  // → '\uD83D\uDC68\u200D' (broken)
 *
 * // Safe:
 * truncate('👨‍👩‍👧‍👦 hello', { max: 3 })  // → '👨‍👩‍👧‍👦 h…'
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface TruncateOptions {
  /** Maximum length in grapheme clusters (visual characters). */
  max: number

  /**
   * String to append when truncated.
   * @default '\u2026' (…)
   */
  ellipsis?: string

  /**
   * Where to truncate.
   *  - `'end'`: keep the head, append ellipsis at the end.
   *  - `'middle'`: keep head + tail, insert ellipsis in the middle.
   * @default 'end'
   */
  position?: 'end' | 'middle'
}

export interface TruncateResult {
  /** The (possibly truncated) text. */
  text: string
  /** Whether truncation occurred. */
  truncated: boolean
  /** Original length in grapheme clusters. */
  originalLength: number
}

// ─── Segmenter (lazy singleton) ─────────────────────────────────────────

let _segmenter: Intl.Segmenter | undefined

function getSegmenter(): Intl.Segmenter {
  return (_segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' }))
}

// ─── Core API ───────────────────────────────────────────────────────────

/**
 * Count grapheme clusters (user-perceived characters) in a string.
 *
 * Unlike `str.length` (UTF-16 code units), this correctly counts:
 * - Combined emoji: 👨‍👩‍👧‍👦 = 1 (not 7)
 * - Flag emoji: 🇯🇵 = 1 (not 2)
 * - Accented chars: é (e + combining accent) = 1 (not 2)
 */
export function graphemeLength(str: string): number {
  // Fast path: ASCII-only strings (very common for paths, IDs, etc.)
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(str)) return str.length

  let count = 0
  for (const _ of getSegmenter().segment(str)) count++
  return count
}

/**
 * Safe substring that operates on grapheme cluster boundaries.
 * Never breaks surrogate pairs or combined emoji sequences.
 *
 * Semantics mirror `Array.prototype.slice(start, end)`.
 */
export function safeSlice(str: string, start: number, end?: number): string {
  // Fast path: when code-unit length is within bounds, the string has no
  // multi-code-unit graphemes, so native .slice() is safe.
  if (end !== undefined && str.length <= end && start === 0) return str

  const segments = [...getSegmenter().segment(str)]
  const sliced = end === undefined ? segments.slice(start) : segments.slice(start, end)
  return sliced.map((s) => s.segment).join('')
}

/**
 * Truncate a string to a maximum number of grapheme clusters.
 *
 * Guarantees:
 * - Never produces lone surrogates or broken emoji.
 * - Result length (in graphemes) ≤ `options.max`.
 * - Ellipsis counts toward the max length.
 *
 * @example
 * truncate('Hello 🚀 World!', { max: 8 })
 * // → 'Hello 🚀…'
 *
 * truncate('A fairly long sentence that needs truncation here', { max: 6 })
 * // → 'A fai…'
 *
 * truncate('path/to/very/long/file.ts', { max: 15, position: 'middle' })
 * // → 'path/t…file.ts'
 */
export function truncate(str: string, options: TruncateOptions): string {
  const { max, ellipsis = '\u2026', position = 'end' } = options

  // Fast path: if UTF-16 code-unit length ≤ max, grapheme count
  // is guaranteed ≤ max (each grapheme has ≥ 1 code unit).
  if (str.length <= max) return str

  const segments = [...getSegmenter().segment(str)]
  if (segments.length <= max) return str

  const ellipsisSegments = [...getSegmenter().segment(ellipsis)]
  const ellipsisLen = ellipsisSegments.length

  if (max <= ellipsisLen) {
    return ellipsisSegments.slice(0, max).map((s) => s.segment).join('')
  }

  if (position === 'middle') {
    const available = max - ellipsisLen
    const headLen = Math.ceil(available / 2)
    const tailLen = available - headLen
    const head = segments.slice(0, headLen).map((s) => s.segment).join('')
    const tail = tailLen > 0 ? segments.slice(-tailLen).map((s) => s.segment).join('') : ''
    return head + ellipsis + tail
  }

  // position === 'end' (default)
  const keepLen = max - ellipsisLen
  return segments.slice(0, keepLen).map((s) => s.segment).join('') + ellipsis
}

/**
 * Truncate with structured metadata.
 *
 * Useful when the caller needs to know whether truncation occurred
 * (e.g., to show a tooltip with the full content).
 */
export function truncateWithMeta(str: string, options: TruncateOptions): TruncateResult {
  const segments = [...getSegmenter().segment(str)]
  const originalLength = segments.length

  if (originalLength <= options.max) {
    return { text: str, truncated: false, originalLength }
  }

  return {
    text: truncate(str, options),
    truncated: true,
    originalLength,
  }
}

// ─── Helpers for message splitting ──────────────────────────────────────

/**
 * Adjust a code-unit index to the nearest grapheme cluster boundary,
 * rounding **down** (toward the start of the string).
 *
 * Use this when you must split at a byte/code-unit position (e.g., API
 * payload limits) but need to avoid breaking a grapheme.
 */
export function snapToGraphemeBoundary(str: string, index: number): number {
  if (index <= 0) return 0
  if (index >= str.length) return str.length

  let boundary = 0
  for (const seg of getSegmenter().segment(str)) {
    const next = seg.index + seg.segment.length
    if (next > index) return boundary
    boundary = next
  }
  return boundary
}
