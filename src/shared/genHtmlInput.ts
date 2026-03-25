// SPDX-License-Identifier: Apache-2.0

/**
 * Shared input contract helpers for `gen_html`.
 *
 * Keeps parsing/normalization consistent across:
 * - native capability execution
 * - renderer widget rendering
 * - artifact extraction
 */

export const GEN_HTML_DEFAULT_TITLE = 'Generated HTML'

export interface ParsedGenHtmlInput {
  title: string
  content: string | null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim().length > 0 ? value : null
}

/**
 * Resolve title + content from tool input.
 *
 * `content` is preferred; `html` is accepted as a legacy alias.
 */
export function parseGenHtmlInput(input: Record<string, unknown>): ParsedGenHtmlInput {
  const title = nonEmptyString(input.title) ?? GEN_HTML_DEFAULT_TITLE
  const content = nonEmptyString(input.content) ?? nonEmptyString(input.html)
  return { title, content }
}
