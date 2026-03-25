// SPDX-License-Identifier: Apache-2.0

import type { Editor } from '@tiptap/core'
import type { SlashItemCategory } from '@shared/slashItems'
import type { SlashCommandExecutionContract } from '@shared/types'
import { compactSlashExecutionContract } from '@shared/slashExecution'
import { mergeSegments, type EditorSegment } from '@shared/editorSegments'

export type { EditorSegment }

/**
 * Walk the ProseMirror document tree and produce an ordered array of segments.
 *
 * - Paragraphs are separated by `\n`
 * - Text nodes become `text` segments
 * - `slashMention` nodes become `slashMention` segments with structured attrs
 * - `fileMention` nodes become `fileMention` segments
 * - Adjacent text segments are merged (via shared `mergeSegments`)
 */
export function extractEditorSegments(editor: Editor): EditorSegment[] {
  const doc = editor.state.doc
  const raw: EditorSegment[] = []

  doc.forEach((block, _offset, index) => {
    // Insert newline between paragraphs
    if (index > 0) {
      raw.push({ type: 'text', text: '\n' })
    }

    block.forEach((child) => {
      if (child.type.name === 'slashMention') {
        const rawLabel = child.attrs.label
        const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''
        const rawMentionId = child.attrs.mentionId
        const mentionId = typeof rawMentionId === 'string' ? rawMentionId.trim() : ''
        const rawExecutionContract = child.attrs.executionContract
        const executionContract =
          rawExecutionContract && typeof rawExecutionContract === 'object'
            ? compactSlashExecutionContract(rawExecutionContract as SlashCommandExecutionContract)
            : undefined
        raw.push({
          type: 'slashMention',
          name: child.attrs.name as string,
          category: child.attrs.category as SlashItemCategory,
          sourcePath: (child.attrs.sourcePath as string) || undefined,
          ...(label ? { label } : {}),
          ...(mentionId ? { mentionId } : {}),
          ...(executionContract ? { executionContract } : {}),
        })
      } else if (child.type.name === 'fileMention') {
        raw.push({
          type: 'fileMention',
          path: child.attrs.path as string,
          name: child.attrs.name as string,
          isDirectory: child.attrs.isDirectory as boolean,
        })
      } else {
        // text node (or any other inline that renders as text)
        const text = child.textContent
        if (text) {
          raw.push({ type: 'text', text })
        }
      }
    })
  })

  // Merge adjacent text segments & trim overall leading/trailing whitespace
  return mergeSegments(raw)
}
