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
  /**
   * Raw HTML markup of the page (null when missing or whitespace-only).
   * Field name mirrors the tool's input field — input/output/UI/artifact
   * stay on a single unambiguous identifier so models cannot reinterpret
   * a generic `content` field as a "page summary".
   */
  html: string | null
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value.trim().length > 0 ? value : null
}

/**
 * Resolve title + html markup from tool input.
 *
 * The tool schema declares a single `html` field. The legacy `content`
 * alias was removed: its semantically loaded name caused some models
 * (notably GPT/Codex) to interpret it as a "page description" and emit
 * the actual HTML in the (then-secondary) `html` field, which the
 * preferred-content resolution silently overrode with the description text.
 */
export function parseGenHtmlInput(input: Record<string, unknown>): ParsedGenHtmlInput {
  return {
    title: nonEmptyString(input.title) ?? GEN_HTML_DEFAULT_TITLE,
    html: nonEmptyString(input.html),
  }
}
