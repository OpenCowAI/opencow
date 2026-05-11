// SPDX-License-Identifier: Apache-2.0

import { parse as parseYaml } from 'yaml'

/**
 * Result of splitting a markdown document into its YAML frontmatter and
 * the remaining body.  When no valid frontmatter is present the input is
 * returned verbatim as `body` with `frontmatter === null`.
 */
export interface ParsedFrontmatter {
  /** Parsed YAML frontmatter map, or `null` when no valid block was found. */
  frontmatter: Record<string, unknown> | null
  /** Markdown body with the frontmatter (and its trailing newline) removed. */
  body: string
}

/**
 * Matches a leading YAML frontmatter block delimited by `---` lines, e.g.
 *
 *   ---
 *   key: value
 *   ---
 *
 * The match is non-greedy on the inner block and tolerates CRLF endings.
 * The trailing newline after the closing `---` is consumed so the
 * remaining body starts cleanly at column 0.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Strip and parse a leading YAML frontmatter block from a markdown
 * document.
 *
 * Why this exists:
 *   `react-markdown` has no awareness of frontmatter — it treats the
 *   leading `---` as a horizontal rule and the next non-blank line as a
 *   setext heading, producing a visually broken preview.  We pre-process
 *   the content so the downstream pipeline sees only the body, and
 *   surface the parsed metadata to callers that want to render it as a
 *   dedicated block.
 *
 * Malformed YAML inside an otherwise valid `---` … `---` block is treated
 * as "no frontmatter": the original content is returned untouched so the
 * user still sees their raw text rather than a silently empty preview.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return { frontmatter: null, body: content }
  try {
    const parsed = parseYaml(match[1])
    // YAML accepts scalars, sequences, and maps at the top level.  Only
    // a non-null map yields useful frontmatter — anything else falls
    // through to the no-op return below.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        frontmatter: parsed as Record<string, unknown>,
        body: content.slice(match[0].length),
      }
    }
  } catch {
    // Malformed YAML — intentionally swallow and treat as no frontmatter.
  }
  return { frontmatter: null, body: content }
}
