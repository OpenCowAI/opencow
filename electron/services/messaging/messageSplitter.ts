// SPDX-License-Identifier: Apache-2.0

import { snapToGraphemeBoundary } from '@shared/unicode'

/**
 * Shared message splitting utility for IM platform formatters.
 *
 * All IM platforms impose message length limits.  This module provides a
 * single, well-tested splitting algorithm that prefers breaking at semantic
 * boundaries (paragraph → line → hard cut) to avoid mid-word/mid-sentence splits.
 *
 * Each platform calls `splitMessage(content, maxLength)` with its own limit:
 *   - Telegram: ~4096 (HTML)
 *   - Feishu:   ~28000 (card content)
 *   - Discord:  ~1900  (Markdown)
 *   - WeChat:   ~2000  (plain text)
 */

/**
 * Split a long message into chunks that respect `maxLength`, preferring
 * breaks at paragraph boundaries (`\n\n`), then line boundaries (`\n`),
 * then falling back to a hard cut at `maxLength`.
 *
 * @param content    The text to split.
 * @param maxLength  Maximum length per chunk (platform-specific).
 * @returns          An array of non-empty chunks.
 */
export function splitMessage(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) return [content]

  const chunks: string[] = []
  let remaining = content

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining)
      break
    }

    // 1. Try to break at a paragraph boundary (\n\n)
    let breakAt = remaining.lastIndexOf('\n\n', maxLength)

    // 2. Fall back to a line boundary (\n)
    if (breakAt < maxLength * 0.5) {
      breakAt = remaining.lastIndexOf('\n', maxLength)
    }

    // 3. Hard cut at maxLength if no good boundary found
    if (breakAt < maxLength * 0.5) {
      breakAt = snapToGraphemeBoundary(remaining, maxLength)
    }

    chunks.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }

  return chunks
}
