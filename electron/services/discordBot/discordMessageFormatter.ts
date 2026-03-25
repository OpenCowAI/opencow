// SPDX-License-Identifier: Apache-2.0

/**
 * DiscordMessageFormatter — converts Claude's ContentBlock[] into Discord-compatible
 * Markdown messages.
 *
 * Discord supports native Markdown:
 *   - Bold, italic, strikethrough, code, code blocks
 *   - Links, ordered/unordered lists
 *   - 2,000 character limit per message
 *   - In-place updates via message.edit()
 */

import type { ContentBlock } from '../../../src/shared/types'
import {
  extractTextFromBlocks as _extractText,
  formatEvoseActivity,
} from '../messaging/contentExtractor'
import { splitMessage } from '../messaging/messageSplitter'
import { truncate as unicodeTruncate } from '@shared/unicode'

const MAX_MESSAGE_LENGTH = 1900  // Leave margin from 2K limit

/**
 * Build a streaming message string for Discord.
 * Appends a streaming indicator when active.
 */
export function buildStreamingMessage(opts: {
  content: string
  isStreaming: boolean
}): string {
  let text = truncate(opts.content, MAX_MESSAGE_LENGTH - 30)

  if (opts.isStreaming) {
    text += '\n\n_Generating..._'
  }

  return text
}

/**
 * Extract text content from Claude's ContentBlock[].
 * Returns Markdown-formatted string (Discord native).
 */
export function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return _extractText(blocks)
}

/**
 * Extract Evose tool activity for streaming placeholder.
 * Uses Discord-specific formatting (bold markdown, text status).
 */
export function extractEvoseActivity(blocks: ContentBlock[]): string | null {
  return formatEvoseActivity(blocks, {
    agentPrefix: '**Agent: ',
    agentSuffix: '**',
  })
}

/**
 * Build a status message showing active sessions.
 */
export function buildStatusMessage(sessions: Array<{ id: string; name?: string; state: string }>): string {
  if (sessions.length === 0) {
    return 'No active sessions.'
  }

  const lines = sessions.map(
    (s, i) => `${i + 1}. **${s.name || s.id.slice(0, 8)}** — ${s.state}`,
  )
  return lines.join('\n')
}

/**
 * Build a help message.
 */
export function buildHelpMessage(): string {
  return [
    '**Available commands:**',
    '',
    '`/new [prompt]` — Start a new session',
    '`/clear` — Clear the current session',
    '`/stop [id]` — Stop a specific session',
    '`/status` — Show active sessions',
    '`/help` — Show this help',
    '',
    'Send any text to chat with AI.',
  ].join('\n')
}

/**
 * Split content into chunks that fit Discord's 2K limit.
 * Tries to break at paragraph or line boundaries.
 */
export function splitForDiscord(content: string): string[] {
  return splitMessage(content, MAX_MESSAGE_LENGTH)
}

function truncate(s: string, max: number): string {
  return unicodeTruncate(s, { max, ellipsis: '\n\n... *(truncated)*' })
}
