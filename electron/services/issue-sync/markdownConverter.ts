// SPDX-License-Identifier: Apache-2.0

/**
 * Bidirectional TipTap JSON ↔ Markdown converter for issue sync.
 *
 * ## Design Decisions
 *
 * The current TipTap editor schema is minimal: doc → paragraph → text / hardBreak /
 * slashMention / fileMention. There are no rich formatting marks (bold, italic) or
 * complex blocks (headings, lists, code blocks).
 *
 * Rather than pulling in a heavy prosemirror-markdown dependency that requires a full
 * schema match, we use a hand-crafted walker that:
 *
 * - **Push (tiptapToMarkdown)**: Walks the TipTap JSON tree and emits Markdown.
 *   Custom nodes (slashMention, fileMention) are rendered as inline references.
 *   Unknown nodes are serialized as plain text.
 *
 * - **Pull (markdownToTiptap)**: Wraps Markdown text in a minimal TipTap JSON
 *   document structure (doc → paragraph → text). This preserves the original Markdown
 *   formatting as-is inside text nodes — acceptable because the issue detail view
 *   renders descriptions via react-markdown, not the TipTap editor.
 *
 * When the editor gains rich formatting support in the future, this module can be
 * upgraded to use prosemirror-markdown or unified (remark/rehype).
 */

// ─── Types ───────────────────────────────────────────────────────────────

/** Minimal TipTap JSON node structure. */
interface TipTapNode {
  type: string
  content?: TipTapNode[]
  text?: string
  attrs?: Record<string, unknown>
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

/** TipTap document root. */
interface TipTapDoc {
  type: 'doc'
  content: TipTapNode[]
}

// ─── TipTap → Markdown ──────────────────────────────────────────────────

/**
 * Convert a TipTap JSON document string to Markdown.
 *
 * @param json - Stringified TipTap JSONContent, or null/empty.
 * @returns Markdown string. Returns empty string for null/invalid input.
 */
export function tiptapToMarkdown(json: string | null): string {
  if (!json) return ''

  let doc: TipTapDoc
  try {
    doc = JSON.parse(json) as TipTapDoc
  } catch {
    return ''
  }

  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return ''

  const paragraphs = doc.content.map(serializeNode)
  return paragraphs.join('\n\n').trim()
}

function serializeNode(node: TipTapNode): string {
  switch (node.type) {
    case 'paragraph':
      return serializeInlineContent(node.content ?? [])

    case 'hardBreak':
      return '\n'

    case 'text':
      return applyMarks(node.text ?? '', node.marks)

    case 'slashMention': {
      const label = (node.attrs?.label ?? node.attrs?.name ?? '') as string
      return `/${label}`
    }

    case 'fileMention': {
      const path = (node.attrs?.path ?? node.attrs?.name ?? '') as string
      return `@${path}`
    }

    // Fallback: if the node has content, recursively serialize; otherwise use text.
    default:
      if (node.content) {
        return node.content.map(serializeNode).join('')
      }
      return node.text ?? ''
  }
}

function serializeInlineContent(nodes: TipTapNode[]): string {
  return nodes.map(serializeNode).join('')
}

/**
 * Apply TipTap marks to text.
 * Currently supports: bold, italic, code, strike, link.
 */
function applyMarks(text: string, marks?: TipTapNode['marks']): string {
  if (!marks || marks.length === 0) return text

  let result = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`
        break
      case 'italic':
        result = `*${result}*`
        break
      case 'code':
        result = `\`${result}\``
        break
      case 'strike':
        result = `~~${result}~~`
        break
      case 'link': {
        const href = (mark.attrs?.href ?? '') as string
        result = `[${result}](${href})`
        break
      }
      // Unknown marks are passed through as-is
    }
  }
  return result
}

// ─── Markdown → TipTap ──────────────────────────────────────────────────

/**
 * Convert a Markdown string to a TipTap JSON document string.
 *
 * This produces a minimal doc structure where each non-empty line becomes a
 * paragraph with a text node. Blank lines separate paragraphs (standard Markdown).
 *
 * The Markdown formatting is preserved as literal text — this is intentional because:
 * 1. The issue detail view uses react-markdown to render descriptions.
 * 2. The TipTap editor currently lacks rich formatting nodes/marks.
 * 3. Preserving the original Markdown prevents lossy round-trips.
 *
 * @param markdown - Raw Markdown string.
 * @returns Stringified TipTap JSONContent. Returns null for empty input.
 */
export function markdownToTiptap(markdown: string): string | null {
  if (!markdown.trim()) return null

  // Split into paragraphs at blank lines (standard Markdown paragraph rules)
  const paragraphs = markdown.split(/\n{2,}/)

  const content: TipTapNode[] = paragraphs
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para): TipTapNode => ({
      type: 'paragraph',
      content: [{ type: 'text', text: para }],
    }))

  if (content.length === 0) return null

  const doc: TipTapDoc = { type: 'doc', content }
  return JSON.stringify(doc)
}
