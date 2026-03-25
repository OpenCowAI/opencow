// SPDX-License-Identifier: Apache-2.0

import { extractSegmentsFromTipTapJson } from './slashExpander'

/**
 * Derive a plain-text description from TipTap document JSON.
 *
 * Walks the TipTap JSON tree and extracts text segments, joining paragraphs
 * with `\n`. Slash mention nodes are represented as `/<name>` and file mention
 * nodes as `@<name>` for human-readable plain-text output.
 *
 * Returns `null` when richContent is null/empty (caller should fall back to
 * the existing `description` field).
 */
export function deriveDescriptionFromRichContent(richContent: string | null | undefined): string | null {
  if (!richContent) return null

  try {
    const segments = extractSegmentsFromTipTapJson(JSON.parse(richContent))
    if (segments.length === 0) return null

    return segments
      .map((seg) => {
        switch (seg.type) {
          case 'text':
            return seg.text
          case 'slashMention':
            return `/${seg.name}`
          case 'fileMention':
            return `@${seg.name}`
        }
      })
      .join('')
      .trim() || null
  } catch {
    return null
  }
}
