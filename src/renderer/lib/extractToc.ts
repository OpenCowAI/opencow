// SPDX-License-Identifier: Apache-2.0

// ---------------------------------------------------------------------------
// extractToc — extract a Table-of-Contents tree from Markdown source text
// ---------------------------------------------------------------------------

export interface TocEntry {
  /** URL-safe slug used as the DOM id on the rendered heading element. */
  id: string
  /** Plain text of the heading (inline formatting stripped). */
  text: string
  /** Heading level 1–6. */
  level: number
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/

/**
 * Generate a URL-safe slug from heading text.
 * Preserves CJK characters (Chinese/Japanese/Korean).
 */
export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff\u3400-\u4dbf\u{20000}-\u{2a6df}\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af-]/gu, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'heading'
  )
}

/**
 * Strip common Markdown inline formatting from heading text.
 * Handles: **bold**, *italic*, `code`, [link](url), ~~strikethrough~~, ![img](url)
 */
function stripInlineFormatting(raw: string): string {
  return raw
    .replace(/!\[.*?\]\(.*?\)/g, '')       // images
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')    // links → text only
    .replace(/\*\*(.+?)\*\*/g, '$1')       // bold
    .replace(/__(.+?)__/g, '$1')           // bold (underscore)
    .replace(/\*(.+?)\*/g, '$1')           // italic
    .replace(/_(.+?)_/g, '$1')             // italic (underscore)
    .replace(/~~(.+?)~~/g, '$1')           // strikethrough
    .replace(/`(.+?)`/g, '$1')             // inline code
    .trim()
}

/**
 * Extract headings from Markdown source text.
 *
 * Rules:
 * - Only ATX-style headings (# … ######) are matched.
 * - Lines inside fenced code blocks (```) are skipped.
 * - Duplicate slugs get `-1`, `-2`, … suffixes.
 */
export function extractToc(markdown: string): TocEntry[] {
  const lines = markdown.split('\n')
  const entries: TocEntry[] = []
  let inCodeBlock = false
  const slugCounts = new Map<string, number>()

  for (const line of lines) {
    // Detect fenced code-block boundaries
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(HEADING_RE)
    if (!match) continue

    const level = match[1].length
    const rawText = stripInlineFormatting(match[2])
    if (!rawText) continue

    let slug = slugify(rawText)

    // Handle duplicate headings → heading, heading-1, heading-2
    const count = slugCounts.get(slug) ?? 0
    slugCounts.set(slug, count + 1)
    if (count > 0) slug = `${slug}-${count}`

    entries.push({ id: slug, text: rawText, level })
  }

  return entries
}
