// SPDX-License-Identifier: Apache-2.0

/**
 * messageDisplayUtils — Pure helpers for extracting display-ready
 * information from user message content blocks.
 *
 * Consolidates a pattern that was duplicated in three places:
 * scanNavAnchors, contextualUserInfo, and renderItem.
 */

import type { ContentBlock, SlashCommandBlock } from '@shared/types'
import { joinSlashDisplays } from '@shared/slashDisplay'

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Concatenate all text blocks from a content array. */
export function extractUserText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
}

// ---------------------------------------------------------------------------
// Structured display info
// ---------------------------------------------------------------------------

export interface UserMessageDisplayInfo {
  /** Joined text of all text blocks, trimmed. */
  text: string
  /** Formatted slash command names (e.g. "/commit /review"). */
  slashNames: string
  /** Whether the message contains image or document blocks. */
  hasMedia: boolean
  /** Whether slashNames is non-empty. */
  hasSlashCmd: boolean
  /** True when the message has no visible content at all. */
  isEmpty: boolean
  /**
   * Ready-to-display text combining slash names and text, or
   * "(attachment)" for media-only messages.  Null when empty.
   */
  displayText: string | null
}

/**
 * Extract display-ready information from user message content blocks.
 *
 * This is the single source of truth for "what does this user message
 * look like as a string?"  Used by nav anchors, contextual question
 * banner, and the renderItem empty-message gate.
 */
export function getUserMessageDisplayInfo(content: readonly ContentBlock[]): UserMessageDisplayInfo {
  const text = extractUserText(content).trim()
  const slashNames = joinSlashDisplays(
    content.filter((b): b is SlashCommandBlock => b.type === 'slash_command'),
  )
  // Engine-emitted media (extracted from a tool_result, carries `toolUseId`
  // provenance) is NOT a user attachment.  Treat it as engine machinery so
  // nav anchors / contextual banners don't claim "(attachment)" for what is
  // really a tool's screenshot.
  const hasMedia = content.some(
    (b) => (b.type === 'image' && !b.toolUseId) || b.type === 'document',
  )
  const hasSlashCmd = slashNames.length > 0
  const isEmpty = !text && !hasMedia && !hasSlashCmd

  let displayText: string | null = null
  if (text) displayText = hasSlashCmd ? `${slashNames} ${text}`.trim() : text
  else if (hasSlashCmd) displayText = slashNames
  else if (hasMedia) displayText = '(attachment)'

  return { text, slashNames, hasMedia, hasSlashCmd, isEmpty, displayText }
}

/**
 * True when a user-role message is entirely engine-emitted machinery
 * (tool_result blocks plus their provenance-stamped media), not real user input.
 *
 * Such messages must NOT render through the chat-bubble / CLI user renderer
 * — they are part of the assistant's tool flow and belong inline, left-aligned,
 * with no bubble or `>` prefix.
 */
export function isToolResultOnlyUserMessage(content: readonly ContentBlock[]): boolean {
  if (content.length === 0) return false
  let hasToolResult = false
  for (const b of content) {
    if (b.type === 'tool_result') {
      hasToolResult = true
      continue
    }
    // Provenance-stamped media (extracted from the same tool_result) is
    // allowed — the toolUseId pins it to engine-emitted output.
    if (b.type === 'image' && b.toolUseId) continue
    // Any other block (text, slash_command, document, plain image, …)
    // means the user typed something — fall back to the regular renderer.
    return false
  }
  return hasToolResult
}
