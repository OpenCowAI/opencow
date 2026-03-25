// SPDX-License-Identifier: Apache-2.0

/**
 * Editor ↔ Content bridge — bidirectional conversion between
 * `UserMessageContent` (the queue/send data format) and TipTap document
 * JSON (the editor's internal representation).
 *
 * This module enables **lossless round-tripping**: queued content can be
 * loaded into a TipTap editor for inline editing, then extracted back to
 * `UserMessageContent` on save — with slash command `expandedText` and
 * context-file metadata preserved via a side-channel metadata map.
 *
 * The bridge intentionally does NOT modify any shared types or node
 * definitions. All context that cannot be stored in TipTap nodes (e.g.
 * `expandedText`) is carried through the `EditMetadata` object.
 *
 * Used by: `QueuedMessageList` (queue item editing)
 */

import type { JSONContent } from '@tiptap/core'
import type { UserMessageContent, SlashCommandBlock } from '@shared/types'
import type { UserMessageBlock } from '@shared/contentBuilder'
import {
  compactSlashExecutionContract,
  normalizeSlashExecutionContract,
} from '@shared/slashExecution'
import { parseContextFiles, serializeContextFiles } from './contextFilesParsing'
import { extractEditorSegments, type EditorSegment } from './extractEditorSegments'
import type { Editor } from '@tiptap/core'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Side-channel metadata that cannot be represented in TipTap node
 * attributes but must survive the edit round-trip.
 */
export interface EditMetadata {
  /**
   * Map of slash mention instance ID → full slash command block.
   * Instance-level keying avoids collisions when the same slash name appears
   * multiple times in one message.
   */
  slashByMentionId: Map<string, SlashCommandBlock>
  /**
   * Media blocks (image, document) that cannot be represented in the
   * text editor. Preserved as-is and appended on save.
   */
  mediaBlocks: UserMessageBlock[]
}

/**
 * Result of converting `UserMessageContent` to a TipTap document.
 */
export interface ContentToEditorResult {
  /** TipTap JSON document — pass to `editor.commands.setContent()` or as `initialContent` */
  doc: JSONContent
  /** Side-channel metadata for the save round-trip */
  metadata: EditMetadata
}

/* ------------------------------------------------------------------ */
/*  Content → Editor (load)                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert `UserMessageContent` into a TipTap document JSON + metadata.
 *
 * Mapping:
 * - `slash_command` block → `slashMention` inline node (expandedText stored in metadata)
 * - `text` block with `<context-files>` → `fileMention` nodes + text nodes
 * - `text` block without `<context-files>` → text/hardBreak nodes within paragraphs
 * - `image` / `document` blocks → metadata.mediaBlocks (not editable in TipTap)
 *
 * Text line structure:
 * - `\n\n` → paragraph boundary
 * - `\n` → new paragraph (TipTap's native paragraph model)
 */
export function contentToEditorDoc(content: UserMessageContent): ContentToEditorResult {
  const slashByMentionId = new Map<string, SlashCommandBlock>()
  const mediaBlocks: UserMessageBlock[] = []

  if (typeof content === 'string') {
    return {
      doc: textToDoc(content),
      metadata: { slashByMentionId, mediaBlocks },
    }
  }

  // Collect inline nodes from all blocks (in original order)
  const inlineNodes: JSONContent[] = []
  let isFirstTextBlock = true

  let slashIndex = 0
  for (const block of content) {
    switch (block.type) {
      case 'slash_command': {
        const mentionId = `slash-${slashIndex++}`
        slashByMentionId.set(mentionId, { ...block })
        inlineNodes.push({
          type: 'slashMention',
          attrs: {
            mentionId,
            name: block.name,
            category: block.category,
            label: block.label || block.name,
            ...(compactSlashExecutionContract(block.execution)
              ? { executionContract: compactSlashExecutionContract(block.execution) }
              : {}),
          },
        })
        inlineNodes.push({ type: 'text', text: ' ' })
        break
      }

      case 'text': {
        if (isFirstTextBlock) {
          isFirstTextBlock = false
          // Parse context-files from the first text block
          const { files, rest } = parseContextFiles(block.text)
          for (const f of files) {
            inlineNodes.push({
              type: 'fileMention',
              attrs: {
                path: f.path,
                name: f.path.split('/').pop() ?? f.path,
                isDirectory: f.isDirectory,
              },
            })
            inlineNodes.push({ type: 'text', text: ' ' })
          }
          if (rest.trim()) {
            inlineNodes.push({ type: 'text', text: rest.trim() })
          }
        } else {
          if (block.text.trim()) {
            inlineNodes.push({ type: 'text', text: block.text.trim() })
          }
        }
        break
      }

      case 'image':
      case 'document':
        mediaBlocks.push(block)
        break
    }
  }

  // No inline content → empty doc
  if (inlineNodes.length === 0) {
    return {
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      metadata: { slashByMentionId, mediaBlocks },
    }
  }

  // Split inline nodes into paragraphs at \n boundaries within text nodes
  const paragraphs = splitIntoParagraphs(inlineNodes)

  return {
    doc: { type: 'doc', content: paragraphs },
    metadata: { slashByMentionId, mediaBlocks },
  }
}

/* ------------------------------------------------------------------ */
/*  Editor → Content (save)                                            */
/* ------------------------------------------------------------------ */

/**
 * Convert a TipTap editor's content back to `UserMessageContent`,
 * using the provided metadata to restore `expandedText` and media blocks.
 *
 * This is the inverse of `contentToEditorDoc` — together they form a
 * lossless round-trip for queue item editing.
 */
export function editorDocToContent(
  editor: Editor,
  metadata: EditMetadata,
): UserMessageContent {
  const segments = extractEditorSegments(editor)
  if (segments.length === 0 && metadata.mediaBlocks.length === 0) {
    return ''
  }

  // Separate file mentions from other segments
  const fileMentions = segments.filter(
    (s): s is EditorSegment & { type: 'fileMention' } => s.type === 'fileMention',
  )
  const nonFileSegments = segments.filter((s) => s.type !== 'fileMention')

  // Convert segments to UserMessageBlocks
  const blocks: UserMessageBlock[] = []
  let hasSlashCommand = false

  for (const seg of nonFileSegments) {
    if (seg.type === 'text') {
      blocks.push({ type: 'text', text: seg.text })
    } else if (seg.type === 'slashMention') {
      const mentionId = typeof seg.mentionId === 'string' ? seg.mentionId.trim() : ''
      const preserved = mentionId ? metadata.slashByMentionId.get(mentionId) : undefined
      if (preserved) {
        blocks.push({
          type: 'slash_command',
          name: preserved.name,
          category: preserved.category,
          label: preserved.label,
          ...(compactSlashExecutionContract(preserved.execution)
            ? { execution: normalizeSlashExecutionContract(preserved.execution) }
            : {}),
          expandedText: preserved.expandedText,
        })
        hasSlashCommand = true
      } else {
        // New slash mention added during editing (no expandedText available)
        // Fall back to empty expandedText — will be resolved on dispatch
        blocks.push({
          type: 'slash_command',
          name: seg.name,
          category: seg.category as 'command' | 'skill',
          label: seg.label?.trim() || seg.name,
          ...(compactSlashExecutionContract(seg.executionContract)
            ? { execution: normalizeSlashExecutionContract(seg.executionContract) }
            : {}),
          expandedText: '',
        })
        hasSlashCommand = true
      }
    }
  }

  // Merge adjacent text blocks FIRST to normalise structure.
  // The editor inserts separator spaces between atom nodes (slashMention,
  // fileMention) which extractEditorSegments returns as separate text
  // segments. Without merging, a no-op edit would fragment text blocks.
  //
  // Context-files prepending must happen AFTER merge so that orphaned
  // separator spaces (from removed fileMention nodes) are collapsed into
  // the adjacent text block and can be trimmed cleanly.
  const merged: UserMessageBlock[] = []
  for (const block of blocks) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null
    if (block.type === 'text' && prev?.type === 'text') {
      ;(prev as { type: 'text'; text: string }).text += block.text
    } else {
      merged.push(block)
    }
  }

  // Prepend context-files to the first text block (matching submit flow).
  // Applied after merge so trimStart() can clean separator whitespace
  // artifacts left behind by extracted fileMention atom nodes.
  if (fileMentions.length > 0) {
    const contextPrefix = serializeContextFiles(fileMentions)
    const firstTextIdx = merged.findIndex((b) => b.type === 'text')
    if (firstTextIdx >= 0) {
      const textBlock = merged[firstTextIdx] as { type: 'text'; text: string }
      merged[firstTextIdx] = {
        type: 'text',
        text: contextPrefix + textBlock.text.trimStart(),
      }
    } else {
      merged.unshift({ type: 'text', text: contextPrefix })
    }
  }

  // Append media blocks (not editable in TipTap, preserved as-is)
  merged.push(...metadata.mediaBlocks)

  // Simplify to plain string if no structured content
  if (!hasSlashCommand && metadata.mediaBlocks.length === 0) {
    return merged.map((b) => (b.type === 'text' ? b.text : '')).join('')
  }

  return merged as UserMessageContent
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/**
 * Convert a plain text string to a TipTap document JSON.
 * Splits on `\n` for paragraph boundaries.
 */
function textToDoc(text: string): JSONContent {
  // Parse context-files from string content too
  const { files, rest } = parseContextFiles(text)
  const inlineNodes: JSONContent[] = []

  for (const f of files) {
    inlineNodes.push({
      type: 'fileMention',
      attrs: {
        path: f.path,
        name: f.path.split('/').pop() ?? f.path,
        isDirectory: f.isDirectory,
      },
    })
    inlineNodes.push({ type: 'text', text: ' ' })
  }

  if (rest.trim()) {
    inlineNodes.push({ type: 'text', text: rest.trim() })
  }

  if (inlineNodes.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] }
  }

  return { type: 'doc', content: splitIntoParagraphs(inlineNodes) }
}

/**
 * Split inline content nodes into paragraph nodes at `\n` boundaries
 * within text nodes.
 */
function splitIntoParagraphs(inlineNodes: JSONContent[]): JSONContent[] {
  const paragraphs: JSONContent[] = []
  let currentContent: JSONContent[] = []

  const flushParagraph = (): void => {
    // Trim trailing whitespace from last text node
    if (currentContent.length > 0) {
      const last = currentContent[currentContent.length - 1]
      if (last.type === 'text' && last.text) {
        const trimmed = last.text.replace(/\s+$/, '')
        if (trimmed) {
          currentContent[currentContent.length - 1] = { type: 'text', text: trimmed }
        } else {
          currentContent.pop()
        }
      }
    }
    paragraphs.push(
      currentContent.length > 0
        ? { type: 'paragraph', content: currentContent }
        : { type: 'paragraph' },
    )
    currentContent = []
  }

  for (const node of inlineNodes) {
    if (node.type !== 'text' || !node.text?.includes('\n')) {
      currentContent.push(node)
      continue
    }

    // Split text at newline boundaries
    const lines = node.text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) flushParagraph()
      if (lines[i]) {
        currentContent.push({ type: 'text', text: lines[i] })
      }
    }
  }

  // Flush remaining content
  if (currentContent.length > 0 || paragraphs.length === 0) {
    flushParagraph()
  }

  return paragraphs
}
