// SPDX-License-Identifier: Apache-2.0

import type { ResolvedBlock } from './slashExpander'
import type { SlashCommandExecutionContract } from './types'

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Attachment info needed to build structured content (renderer-side).
 *
 * Modelled as a discriminated union matching the shape of `ProcessedAttachment`
 * from attachmentUtils — each variant carries only the fields relevant to its
 * kind, so callers can pass `ProcessedAttachment[]` directly without mapping.
 */
export type ContentAttachment =
  | { kind: 'image'; mediaType: string; base64Data: string; sizeBytes: number }
  | { kind: 'document'; mediaType: string; data: string; sizeBytes: number; fileName: string }

/**
 * Discriminated union of all block types that can appear in a `UserMessageContent` array.
 *
 * This is the canonical single source of truth for user message block types.
 * Consumers that need to work with individual blocks (e.g. `useMessageQueue` merge,
 * `QueuedMessageList` editing) should import this type instead of redeclaring local aliases.
 *
 * NOTE: This is distinct from `ContentBlock` in `@shared/types` which covers
 * session console blocks (includes ToolUseBlock, ToolResultBlock, ThinkingBlock, etc.).
 */
export type UserMessageBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; sizeBytes: number }
  | { type: 'document'; mediaType: string; data: string; sizeBytes: number; title: string }
  | {
      type: 'slash_command'
      name: string
      category: 'command' | 'skill'
      label: string
      execution?: SlashCommandExecutionContract
      expandedText: string
    }

// ─── Builder ────────────────────────────────────────────────────────────────

/**
 * Build UserMessageContent from resolved blocks + attachments.
 *
 * - No slash_command and no attachments → plain string (backward compat)
 * - Has slash_command or attachment → block array with structural information
 *
 * This is a pure function extracted from useMessageComposer so it can be
 * shared between the Console input and Notes send-to-chat.
 */
export function buildStructuredContent(
  resolvedBlocks: ResolvedBlock[],
  attachments: ContentAttachment[]
): string | UserMessageBlock[] {
  const hasSlashCommand = resolvedBlocks.some((b) => b.type === 'slash_command')

  if (!hasSlashCommand && attachments.length === 0) {
    // Pure text — join all text blocks into a single string
    return resolvedBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
  }

  // Mixed: build content block array preserving slash_command structure
  const blocks: UserMessageBlock[] = []

  for (const rb of resolvedBlocks) {
    if (rb.type === 'text') {
      blocks.push({ type: 'text', text: rb.text })
    } else {
      blocks.push({
        type: 'slash_command',
        name: rb.name,
        category: rb.category,
        label: rb.label,
        execution: rb.execution,
        expandedText: rb.expandedText,
      })
    }
  }

  for (const att of attachments) {
    switch (att.kind) {
      case 'image':
        blocks.push({
          type: 'image',
          mediaType: att.mediaType,
          data: att.base64Data,
          sizeBytes: att.sizeBytes,
        })
        break
      case 'document':
        blocks.push({
          type: 'document',
          mediaType: att.mediaType,
          data: att.data,
          sizeBytes: att.sizeBytes,
          title: att.fileName,
        })
        break
    }
  }

  return blocks
}
