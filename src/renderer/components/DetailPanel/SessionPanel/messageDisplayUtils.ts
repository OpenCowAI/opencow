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
  const hasMedia = content.some((b) => b.type === 'image' || b.type === 'document')
  const hasSlashCmd = slashNames.length > 0
  const isEmpty = !text && !hasMedia && !hasSlashCmd

  let displayText: string | null = null
  if (text) displayText = hasSlashCmd ? `${slashNames} ${text}`.trim() : text
  else if (hasSlashCmd) displayText = slashNames
  else if (hasMedia) displayText = '(attachment)'

  return { text, slashNames, hasMedia, hasSlashCmd, isEmpty, displayText }
}
