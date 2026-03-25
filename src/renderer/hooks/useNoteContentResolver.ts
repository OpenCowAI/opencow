// SPDX-License-Identifier: Apache-2.0

import { useCallback } from 'react'
import { parseSlashMentionSegments } from '@shared/editorSegments'
import { resolveSlashSegments } from '@shared/slashExpander'
import { buildStructuredContent } from '@shared/contentBuilder'
import { getAppAPI } from '@/windowAPI'
import { useProjectScope } from '@/contexts/ProjectScopeContext'
import type { SessionNote, UserMessageContent } from '@shared/types'

/**
 * Hook that provides a `resolveNoteContent` function for resolving a note's
 * slash command mentions into structured `UserMessageContent`.
 *
 * Used by both `NotesView` (session panel) and `NotePopover` (file viewer)
 * to ensure slash commands are always resolved before sending to chat —
 * eliminating the previous inconsistency where popover sent plain text.
 *
 * Uses `parseSlashMentionSegments` (single parse) instead of separate
 * `richContentHasSlashMentions` + `extractSegmentsFromJson` to avoid
 * double-parsing the same JSON.
 */
export function useNoteContentResolver(): (note: SessionNote) => Promise<UserMessageContent> {
  const { projectPath } = useProjectScope()

  return useCallback(
    async (note: SessionNote): Promise<UserMessageContent> => {
      const imageAttachments = (note.content.images ?? []).map((img) => ({
        kind: 'image' as const,
        mediaType: img.mediaType,
        base64Data: img.data,
        sizeBytes: img.sizeBytes,
      }))

      const buildFallbackContent = (): UserMessageContent => {
        if (imageAttachments.length === 0) {
          return note.content.text
        }
        const textBlocks = note.content.text
          ? [{ type: 'text' as const, text: note.content.text }]
          : []
        return buildStructuredContent(textBlocks, imageAttachments)
      }

      // Single-pass: parse richContent and check for slash mentions in one step
      const segments = parseSlashMentionSegments(note.content.richContent)
      if (!segments) {
        return buildFallbackContent()
      }

      try {
        const nonFileSegments = segments.filter((s) => s.type !== 'fileMention')
        const { blocks } = await resolveSlashSegments(nonFileSegments, async (sourcePath) => {
          const result = await getAppAPI()['read-capability-source'](sourcePath, projectPath)
          return result.content
        })
        return buildStructuredContent(blocks, imageAttachments)
      } catch {
        // Fallback to plain note content on any parsing/resolution error
        return buildFallbackContent()
      }
    },
    [projectPath],
  )
}
