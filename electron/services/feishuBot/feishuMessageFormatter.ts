// SPDX-License-Identifier: Apache-2.0

/**
 * FeishuMessageFormatter — converts Claude's ContentBlock[] into Feishu-compatible
 * message formats (Interactive Cards for streaming, Markdown for final).
 *
 * Feishu Interactive Cards support:
 *   - Markdown rendering (bold, italic, code, links, lists)
 *   - Code blocks with language tags
 *   - In-place updates via PATCH (ideal for streaming)
 *   - Action buttons (for stop session)
 *   - 30,000 character limit (much more generous than Telegram's 4,096)
 */

import type { ContentBlock } from '../../../src/shared/types'
import {
  extractTextFromBlocks as _extractText,
  formatEvoseActivity,
} from '../messaging/contentExtractor'
import { splitMessage } from '../messaging/messageSplitter'
import { truncate as unicodeTruncate } from '@shared/unicode'

const MAX_CARD_LENGTH = 28000  // Leave margin from 30K limit

/**
 * Build an Interactive Card JSON string for Feishu.
 * Used for streaming updates (card can be PATCHed in place).
 */
export function buildStreamingCard(opts: {
  content: string
  isStreaming: boolean
  sessionId?: string
}): string {
  const elements: unknown[] = []

  // Main content block (Markdown)
  if (opts.content) {
    elements.push({
      tag: 'markdown',
      content: truncate(opts.content, MAX_CARD_LENGTH),
    })
  }

  // Streaming indicator
  if (opts.isStreaming) {
    elements.push({
      tag: 'hr',
    })
    elements.push({
      tag: 'markdown',
      content: '⏳ *Generating...*',
    })
  }

  const card = {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements,
  }

  return JSON.stringify(card)
}

/**
 * Build a final message card (after streaming completes).
 */
export function buildFinalCard(content: string): string {
  const card = {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: truncate(content, MAX_CARD_LENGTH),
      },
    ],
  }
  return JSON.stringify(card)
}

/**
 * Build a simple text message JSON.
 */
export function buildTextMessage(text: string): string {
  return JSON.stringify({ text })
}

/**
 * Extract text content from Claude's ContentBlock[].
 * Returns Markdown-formatted string with Feishu-style tool markers.
 */
export function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return _extractText(blocks, (name) => `\n🔧 *Using: ${name}*\n`)
}

/**
 * Extract Evose tool activity for streaming placeholder.
 * Uses Feishu-specific formatting (emoji icons, bold markdown).
 */
export function extractEvoseActivity(blocks: ContentBlock[]): string | null {
  return formatEvoseActivity(blocks, {
    agentPrefix: '🔄 **Agent: ',
    agentSuffix: '**',
    runningIcon: '🔍',
    completedIcon: '✅',
    errorIcon: '❌',
  })
}

/**
 * Build a status message card showing active sessions.
 */
export function buildStatusCard(sessions: Array<{ id: string; name?: string; state: string }>): string {
  const lines = sessions.length === 0
    ? ['📋 No active sessions']
    : sessions.map((s, i) => `${i + 1}. **${s.name || s.id.slice(0, 8)}** — ${s.state}`)

  return buildFinalCard(lines.join('\n'))
}

/**
 * Build the menu card — Interactive Card with action buttons.
 * Feishu equivalent of Telegram's InlineKeyboard menu panel.
 *
 * Button values use `{ "action": "cmd_name" }` which are received
 * via the `card.action.trigger` event when clicked.
 */
export function buildMenuCard(): string {
  const card = {
    config: { wide_screen_mode: true, enable_forward: false },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '🤖 OpenCow — AI Assistant' },
    },
    elements: [
      { tag: 'markdown', content: 'Send a message directly to chat with Claude, or use the shortcuts below:' },
      { tag: 'hr' },
      // ── Chat actions ──────────────────────────────────────────
      { tag: 'markdown', content: '**💬 Chat**' },
      {
        tag: 'action',
        actions: [
          btn('🆕 New Chat',  'new',    'primary'),
          btn('🗑️ Clear',    'clear',  'default'),
          btn('⏹️ Stop',     'stop',   'danger'),
        ],
      },
      { tag: 'hr' },
      // ── Info ──────────────────────────────────────────────────
      { tag: 'markdown', content: '**📊 Info**' },
      {
        tag: 'action',
        actions: [
          btn('📋 Status',  'status', 'default'),
          btn('❓ Help',    'help',   'default'),
        ],
      },
    ],
  }
  return JSON.stringify(card)
}

/** Shorthand for a Feishu card button element. */
function btn(label: string, action: string, type: 'primary' | 'default' | 'danger' = 'default') {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: label },
    type,
    value: { action },
  }
}

/**
 * Build a help message card (text-only fallback, no buttons).
 */
export function buildHelpCard(): string {
  const help = [
    '**Available commands:**',
    '',
    '• `/menu` — Open menu panel',
    '• `/new [prompt]` — Start a new session',
    '• `/clear` — Terminate the current session',
    '• `/stop [id]` — Stop a specific session',
    '• `/status` — Show active sessions',
    '• `/help` — Show this help',
    '',
    'Send text directly to chat with the AI.',
  ]
  return buildFinalCard(help.join('\n'))
}

/**
 * Split content into chunks that fit Feishu's card limit.
 * Feishu has a generous 30K limit so splitting is rarely needed.
 */
export function splitForFeishu(content: string): string[] {
  return splitMessage(content, MAX_CARD_LENGTH)
}

function truncate(s: string, max: number): string {
  return unicodeTruncate(s, { max, ellipsis: '\n\n... *(Content too long, truncated)*' })
}
