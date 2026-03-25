// SPDX-License-Identifier: Apache-2.0

import type { ContentBlock, ToolUseBlock, EvoseToolCallBlock, EvoseTextBlock } from '../../../src/shared/types'
import {
  isEvoseToolName,
  extractEvoseLocalName,
  EVOSE_RUN_AGENT_LOCAL_NAME,
  EVOSE_RUN_WORKFLOW_LOCAL_NAME,
  EVOSE_LIST_APPS_LOCAL_NAME,
} from '../../../src/shared/evoseNames'
import { truncate, safeSlice, snapToGraphemeBoundary } from '@shared/unicode'

// ─── Telegram Inline Keyboard Types ──────────────────────────────────────────

/**
 * Inline keyboard button — mutually exclusive action fields (Bot API 9.4).
 *
 * All variants carry a `text` label and exactly one action field:
 *   callback_data  — fires a callback query back to the bot (≤ 64 bytes)
 *   url            — opens an external URL when tapped
 *   copy_text      — copies text to the user's clipboard (Bot API 7.11+, ≤ 256 chars)
 */
export type InlineKeyboardButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  | { text: string; copy_text: { text: string } }

/** Inline keyboard layout — a grid of button rows */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

/**
 * ForceReply markup — instructs Telegram to focus the user's reply input
 * and optionally show a placeholder string inside the text field.
 * selective: true limits the effect to the user being replied to (useful in groups).
 */
export interface ForceReplyMarkup {
  force_reply: true
  input_field_placeholder?: string
  selective?: boolean
}

export interface FormattedMessage {
  text: string
  parse_mode: 'MarkdownV2' | 'HTML'
  reply_markup?: InlineKeyboardMarkup | ForceReplyMarkup
}

const STATE_EMOJI: Record<string, string> = {
  creating: '🔄',
  streaming: '⚡',
  awaiting_input: '⏳',
  awaiting_question: '❓',
  idle: '💤',
  stopping: '🛑',
  stopped: '⏹️',
  error: '❌',
}

// ─── Telegram HTML Formatter ───────────────────────────────────────────────

/**
 * Convert Claude's Markdown output to Telegram-compatible HTML.
 *
 * Telegram HTML supports a small subset of HTML:
 *   <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>
 *
 * This converter handles the Markdown patterns that Claude commonly produces:
 *   - Fenced code blocks (with optional language)
 *   - Headings (# → <b>)
 *   - Blockquotes (> → <blockquote>)
 *   - Bold (**text** / __text__)
 *   - Italic (*text* / _text_)
 *   - Strikethrough (~~text~~)
 *   - Inline code (`text`)
 *   - Links ([text](url))
 *   - Unordered and ordered lists
 *   - Horizontal rules
 */
function convertMarkdownToHtml(text: string): string {
  const lines = text.split('\n')
  const output: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ── Fenced code block ──────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim().replace(/[^a-zA-Z0-9+#-]/g, '').toLowerCase()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      const escaped = escapeHtml(codeLines.join('\n'))
      const langAttr = lang ? ` class="language-${lang}"` : ''
      output.push(`<pre><code${langAttr}>${escaped}</code></pre>`)
      continue
    }

    // ── Heading (# / ## / ###) ─────────────────────────────────────────────
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      output.push(`<b>${processInline(headingMatch[2])}</b>`)
      i++
      continue
    }

    // ── Horizontal rule ─────────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      output.push('─────────────────')
      i++
      continue
    }

    // ── Blockquote (collect consecutive > lines) ────────────────────────────
    if (line.startsWith('> ') || line === '>') {
      const quoteLines: string[] = []
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        quoteLines.push(lines[i].startsWith('> ') ? lines[i].slice(2) : '')
        i++
      }
      const content = quoteLines.map((l) => processInline(l)).join('\n')
      // Long blockquotes (> 6 lines) collapse by default — Bot API 7.0+ expandable attribute.
      // Only applied to explicit Markdown `>` blocks; never wraps Claude's own prose.
      const isLong = quoteLines.length > 6
      output.push(isLong
        ? `<blockquote expandable>${content}</blockquote>`
        : `<blockquote>${content}</blockquote>`)
      continue
    }

    // ── Unordered list item ─────────────────────────────────────────────────
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)$/)
    if (ulMatch) {
      const indent = ulMatch[1].length
      const bullet = indent >= 2 ? '  •' : '•'
      output.push(`${bullet} ${processInline(ulMatch[3])}`)
      i++
      continue
    }

    // ── Ordered list item ───────────────────────────────────────────────────
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/)
    if (olMatch) {
      const indent = olMatch[1].length
      const num = olMatch[2]
      const prefix = indent >= 2 ? `  ${num}.` : `${num}.`
      output.push(`${prefix} ${processInline(olMatch[3])}`)
      i++
      continue
    }

    // ── Empty line ──────────────────────────────────────────────────────────
    if (line.trim() === '') {
      output.push('')
      i++
      continue
    }

    // ── Regular paragraph line ──────────────────────────────────────────────
    output.push(processInline(line))
    i++
  }

  // Collapse runs of 3+ blank lines down to 2
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Escape HTML entities in plain text (not in generated tags) */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Convert a raw MCP tool name to a human-readable display name.
 *
 * Evose tools:
 *   'mcp__opencow-capabilities__evose_run_agent' + app_id=foo → 'Evose Agent (foo)'
 *   'mcp__opencow-capabilities__evose_run_workflow' + app_id=bar → 'Evose Workflow (bar)'
 *
 * Regular tools are returned as-is (e.g. 'Bash', 'Read', 'Edit').
 */
function humanizeToolName(blockName: string, input?: Record<string, unknown>): string {
  if (!isEvoseToolName(blockName)) return blockName
  const localName = extractEvoseLocalName(blockName)
  const appId = typeof input?.['app_id'] === 'string' ? input['app_id'].trim() : ''

  if (localName === EVOSE_RUN_AGENT_LOCAL_NAME) {
    return appId ? `Evose Agent (${appId})` : 'Evose Agent'
  }
  if (localName === EVOSE_RUN_WORKFLOW_LOCAL_NAME) {
    return appId ? `Evose Workflow (${appId})` : 'Evose Workflow'
  }
  if (localName === EVOSE_LIST_APPS_LOCAL_NAME) {
    return 'Evose Apps'
  }

  return 'Evose'
}

// ─── Evose Tool Call Rendering Helpers ───────────────────────────────────────

/**
 * Emoji icons for common Evose sub-tool names.
 * Approximates the rich icons shown in the desktop Evose UI.
 * Keys are matched case-insensitively against `toolName` (snake_case from MCP).
 */
const EVOSE_TOOL_ICONS: Record<string, string> = {
  twitter_advanced_search: '𝕏',
  twitter_search:          '𝕏',
  web_search:              '🔍',
  web_search_using_tavily: '🔍',
  tavily_search:           '🔍',
  browser_navigate:        '🌐',
  browser_extract:         '📄',
  browser_screenshot:      '📸',
  browser_click:           '👆',
  browser_type:            '⌨️',
  current_time:            '🕐',
  get_current_time:        '🕐',
  read_file:               '📖',
  write_file:              '📝',
  create_issue:            '📋',
  list_issues:             '📋',
  gen_html:                '🎨',
}

/**
 * Resolve an emoji icon for an Evose sub-tool call.
 * Falls back to the status emoji if no specific icon is found.
 */
function evoseToolIcon(toolName: string): string | null {
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return EVOSE_TOOL_ICONS[normalized] ?? null
}

/**
 * Extract a compact semantic description from kwargs.
 *
 * The Evose desktop UI shows "Twitter Advanced Search: search AI Agent product discussions (Top)"
 * where the Chinese text comes from kwargs (e.g. { query: "...", sort: "Top" }).
 * This helper extracts the most meaningful value for a concise description.
 */
function extractKwargsDescription(kwargs?: Record<string, unknown>): string | null {
  if (!kwargs) return null

  // Priority: common descriptive fields
  for (const key of ['query', 'description', 'url', 'prompt', 'text', 'search_query', 'keyword']) {
    const val = kwargs[key]
    if (typeof val === 'string' && val.trim()) {
      return truncate(val.trim(), { max: 80 })
    }
  }

  // Fallback: first short string value
  for (const val of Object.values(kwargs)) {
    if (typeof val === 'string' && val.trim().length > 0 && val.trim().length < 120) {
      return truncate(val.trim(), { max: 80 })
    }
  }
  return null
}

/**
 * Render a single Evose tool call line with icon, title, kwargs description, and status.
 *
 * Format: `✅ 𝕏 Twitter Advanced Search · search AI Agent product discussions`
 *     or: `🔄 🔍 Web Search Using Tavily · web search AI Agent popular products...`
 */
function formatEvoseToolCallLine(
  tc: EvoseToolCallBlock,
  statusEmoji: string,
): string {
  const icon = evoseToolIcon(tc.toolName)
  const suffix = tc.status === 'running' ? '...' : ''
  const desc = extractKwargsDescription(tc.kwargs)

  const titlePart = icon
    ? `${icon} ${escapeHtml(tc.title)}`
    : escapeHtml(tc.title)

  const descPart = desc ? ` · ${escapeHtml(desc)}` : ''

  return `${statusEmoji} ${titlePart}${descPart}${suffix}`
}

/**
 * Process inline Markdown within a single line → Telegram HTML.
 * Order of operations is critical: protect code spans and links first,
 * escape remaining HTML, apply bold/italic, then restore protected parts.
 */
function processInline(raw: string): string {
  const slots: string[] = []
  const protect = (html: string): string => {
    const idx = slots.length
    slots.push(html)
    return `\x00S${idx}\x00`
  }

  let s = raw

  // 1. Protect fenced inline code: `code`
  s = s.replace(/`([^`\n]+)`/g, (_, code) => protect(`<code>${escapeHtml(code)}</code>`))

  // 2. Protect Markdown links: [text](url) — images ![alt](url) → keep alt text only
  s = s.replace(/!?\[([^\]\n]*)\]\(([^)\n]+)\)/g, (m, text, url) => {
    if (m.startsWith('!')) return protect(escapeHtml(text))
    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    return protect(`<a href="${safeUrl}">${escapeHtml(text)}</a>`)
  })

  // 3. Escape HTML in the remaining plain text
  s = escapeHtml(s)

  // 4. Bold + italic: ***text***
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')

  // 5. Bold: **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  s = s.replace(/__(.+?)__/g, '<b>$1</b>')

  // 6. Italic: *text* or _text_ (non-greedy, single line)
  s = s.replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
  s = s.replace(/_([^_\n]+)_/g, '<i>$1</i>')

  // 7. Strikethrough: ~~text~~
  s = s.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // 8. Restore protected slots
  // eslint-disable-next-line no-control-regex -- NUL bytes used as slot placeholders (see protect() above)
  s = s.replace(/\x00S(\d+)\x00/g, (_, idx) => slots[parseInt(idx)])

  return s
}

/**
 * Split HTML string at semantic boundaries (never inside a <pre> block)
 * such that each chunk is ≤ maxLen characters.
 */
function splitHtmlAtSemanticBoundary(html: string, maxLen: number): string[] {
  if (html.length <= maxLen) return [html]

  const chunks: string[] = []
  let remaining = html

  while (remaining.length > maxLen) {
    let splitAt = maxLen

    // Prefer splitting right after a closing </pre> tag
    const preEnd = remaining.lastIndexOf('</pre>', maxLen)
    if (preEnd > maxLen / 3) {
      splitAt = preEnd + '</pre>'.length
    } else {
      // Fall back to paragraph boundary
      const paraEnd = remaining.lastIndexOf('\n\n', maxLen)
      if (paraEnd > maxLen / 3) {
        splitAt = paraEnd
      } else {
        // Fall back to line boundary
        const lineEnd = remaining.lastIndexOf('\n', maxLen)
        if (lineEnd > maxLen / 3) splitAt = lineEnd
      }
    }

    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trimStart()
  }

  if (remaining.trim()) chunks.push(remaining.trim())
  return chunks
}

// ─── MessageFormatter class ────────────────────────────────────────────────

export class MessageFormatter {
  // ── MarkdownV2 helpers (used by status/notification messages) ─────────────

  /** Escape special characters for Telegram MarkdownV2 */
  escapeMd(text: string): string {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
  }

  // ── Status & notification messages (MarkdownV2) ───────────────────────────

  statusMessage(
    sessions: Array<{ id: string; name: string; state: string; activity: string | null }>,
  ): FormattedMessage {
    if (sessions.length === 0) {
      return {
        text: '*📋 OpenCow — Session Status*\n\nNo active sessions',
        parse_mode: 'MarkdownV2',
      }
    }
    const lines = sessions.map((s) => {
      const emoji = STATE_EMOJI[s.state] ?? '❓'
      const name = this.escapeMd(s.name)
      const id = this.escapeMd(s.id.slice(0, 8))
      const activity = s.activity ? ` — ${this.escapeMd(s.activity)}` : ''
      return `${emoji} *${name}* \`${id}\`${activity}`
    })
    const count = this.escapeMd(`${sessions.length} session(s) total`)
    return {
      text: `*📋 OpenCow — Session Status*\n\n${lines.join('\n')}\n\n_${count}_`,
      parse_mode: 'MarkdownV2',
    }
  }

  /**
   * A minimal "round done" footer sent at the end of every Telegram-originated session.
   *
   * Design intent: this is a conversation UI marker, not a push notification.
   * It should be compact and unobtrusive — the user can see at a glance that
   * Claude has finished and know exactly what to do next.
   *
   * Stop-reason variants:
   *   max_tokens   → warn the user (truncated output is likely)
   *   end_turn     → normal completion, no special note needed
   *   (others)     → treat as normal completion
   */
  sessionDoneMessage(stopReason?: string): FormattedMessage {
    const isTokenLimit = stopReason === 'max_tokens'
    const header = isTokenLimit
      ? '<b>⚠️ This round is complete</b> (output reached token limit, some content may be truncated)'
      : '<b>✅ This round is complete</b>'
    return {
      text: `${header}\n\n💬 Send a message to continue the conversation`,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '🆕 New Topic', callback_data: 'cmd:new' },
        ]],
      },
    }
  }

  errorMessage(params: {
    sessionId: string
    sessionName: string
    error: string
  }): FormattedMessage {
    const name = this.escapeMd(params.sessionName)
    const id = this.escapeMd(params.sessionId.slice(0, 8))
    const error = this.escapeMd(params.error)
    return {
      text: `*❌ OpenCow — Session Error*\n\n*Session:* ${name} \`${id}\`\n*Error:* ${error}`,
      parse_mode: 'MarkdownV2',
    }
  }

  sessionCreatedMessage(sessionId: string, prompt: string): FormattedMessage {
    const id = this.escapeMd(sessionId.slice(0, 8))
    const p = this.escapeMd(
      typeof prompt === 'string' ? safeSlice(prompt, 0, 200) : safeSlice(String(prompt), 0, 200),
    )
    return {
      text: `*✅ Session Created*\n\n*ID:* \`${id}\`\n*Prompt:* ${p}`,
      parse_mode: 'MarkdownV2',
    }
  }

  /**
   * Help / main menu message with a grouped InlineKeyboard.
   *
   * Four visual sections (section-header rows are non-actionable `noop` buttons):
   *   1. 💬 Chat    — new topic, clear, stop
   *   2. 🐛 Issues  — view / create Issues (coming soon)
   *   3. 📁 Projects — project list / switch workspace (coming soon)
   *   4. ⋯ More    — session status
   *
   * Telegram doesn't support native grouping, so section headers are rendered
   * as single-button rows with `callback_data: 'noop'`.  The bot answers them
   * with an empty callback query (no toast) so they feel inert to the user.
   */
  helpMessage(): FormattedMessage {
    return {
      text: '🤖 <b>OpenCow — AI Assistant</b>\n\nSend a message directly to chat with Claude, no commands needed.',
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          // ── Group 1: Chat ─────────────────────────────────────────────────
          [{ text: '── 💬 Chat ──', callback_data: 'noop' }],
          [
            { text: '🆕 New Chat', callback_data: 'cmd:new' },
            { text: '🗑️ Clear',   callback_data: 'cmd:clear' },
            { text: '⏹️ Stop',    callback_data: 'cmd:stop' },
          ],
          // ── Group 2: Issues ───────────────────────────────────────────────
          [{ text: '── 🐛 Issues ──', callback_data: 'noop' }],
          [
            { text: '📋 View Issues',  callback_data: 'cmd:issues' },
            { text: '📝 New Issue',    callback_data: 'cmd:issues:new' },
          ],
          // ── Group 3: Projects ─────────────────────────────────────────────
          [{ text: '── 📁 Projects ──', callback_data: 'noop' }],
          [
            { text: '📂 Projects',        callback_data: 'cmd:projects' },
            { text: '⚙️ Switch Project', callback_data: 'cmd:projects:switch' },
          ],
          // ── Group 4: More ─────────────────────────────────────────────────
          [{ text: '── ⋯ More ──', callback_data: 'noop' }],
          [
            { text: '📊 Status', callback_data: 'cmd:status' },
          ],
        ],
      },
    }
  }

  textMessage(text: string): FormattedMessage {
    return { text: this.escapeMd(text), parse_mode: 'MarkdownV2' }
  }

  /**
   * A ForceReply prompt message.
   *
   * Telegram will automatically focus the user's input field and display
   * an "↩️ Reply to" banner pointing at this message, creating a guided
   * two-step input flow (e.g. /new → bot asks question → user replies).
   *
   * @param promptText  The question shown to the user (plain text, not escaped)
   * @param placeholder Optional placeholder text inside the input field
   */
  forceReplyMessage(promptText: string, placeholder = 'Type your question...'): FormattedMessage {
    return {
      text: this.escapeMd(promptText),
      parse_mode: 'MarkdownV2',
      reply_markup: {
        force_reply: true,
        input_field_placeholder: placeholder,
        selective: true, // only apply to the user being replied to (Bot API best practice)
      },
    }
  }

  permissionDeniedMessage(): FormattedMessage {
    return {
      text: '⛔ *Permission Denied*: You are not in the allowed user list\\.',
      parse_mode: 'MarkdownV2',
    }
  }

  // ── Assistant content formatting (Telegram HTML) ──────────────────────────

  /**
   * Format a single ToolUseBlock as a compact Telegram HTML summary.
   *
   * Shows: <emoji> <b>ToolName</b>: <code>primary-input-value</code>
   *
   * The "primary field" is the most human-readable input for each tool
   * (e.g. `command` for Bash, `file_path` for Read/Write/Edit).
   * For unknown tools the first string-typed input value is shown.
   * Values are truncated to 200 chars to keep the message scannable.
   */
  private formatToolCall(block: ToolUseBlock): string {
    const TOOL_EMOJIS: Record<string, string> = {
      Bash: '💻', Read: '📖', Write: '📝', Edit: '✏️', MultiEdit: '✏️',
      Glob: '🗂️', Grep: '🔍', WebFetch: '🌐', WebSearch: '🔍',
      Task: '🤖', TodoWrite: '📋', TodoRead: '📋', NotebookEdit: '📓',
    }
    const PRIMARY_FIELDS: Record<string, string> = {
      Bash: 'command', Read: 'file_path', Write: 'file_path',
      Edit: 'file_path', MultiEdit: 'file_path', Glob: 'pattern',
      Grep: 'pattern', WebFetch: 'url', WebSearch: 'query',
      Task: 'description',
    }

    const displayName = humanizeToolName(block.name, block.input)
    const emoji = TOOL_EMOJIS[block.name] ?? (isEvoseToolName(block.name) ? '🤖' : '⚙️')
    const nameHtml = `<b>${escapeHtml(displayName)}</b>`

    const field = PRIMARY_FIELDS[block.name]
    let rawValue: string | null = null

    if (field && block.input[field] != null) {
      rawValue = String(block.input[field])
    } else if (block.name === 'Task' && block.input.prompt != null) {
      // Task tool uses 'prompt' as an alternative to 'description'
      rawValue = String(block.input.prompt)
    } else {
      // Fallback: first string-typed input value
      const firstStr = Object.values(block.input).find((v) => v != null && typeof v === 'string')
      if (firstStr !== undefined) rawValue = String(firstStr)
    }

    if (!rawValue) return `${emoji} ${nameHtml}`

    const truncated = truncate(rawValue, { max: 200 })
    return `${emoji} ${nameHtml}: <code>${escapeHtml(truncated)}</code>`
  }

  /**
   * Convert a list of ContentBlocks from an assistant message into one or more
   * Telegram HTML strings, each within the 4096-character limit.
   *
   * Renders:
   *   - TextBlocks   → Markdown-to-HTML conversion
   *   - ToolUseBlocks → compact summary (emoji + tool name + primary input)
   *
   * Other block types (ToolResult, Image, Thinking) are skipped as they are
   * either internal details or not representable in Telegram HTML.
   */
  formatAssistantBlocks(blocks: ContentBlock[]): string[] {
    const htmlParts: string[] = []

    for (const block of blocks) {
      if (block.type === 'text') {
        const trimmed = block.text.trim()
        if (!trimmed) continue
        htmlParts.push(convertMarkdownToHtml(trimmed))
      } else if (block.type === 'tool_use') {
        // Evose agents: render rich summary with tool calls + text output.
        // Regular tools: compact one-liner (emoji + name + primary input).
        const evoseSummary = this.formatEvoseSummary(block)
        htmlParts.push(evoseSummary ?? this.formatToolCall(block))
      }
      // image, tool_result, thinking, slash_command — skipped
    }

    if (htmlParts.length === 0) return []

    // Combine parts, splitting into ≤ 4096-char chunks at semantic boundaries
    const MAX = 4096
    const chunks: string[] = []
    let current = ''

    for (const part of htmlParts) {
      const partChunks = splitHtmlAtSemanticBoundary(part, MAX)
      for (const chunk of partChunks) {
        const separator = current ? '\n\n' : ''
        if (current && separator.length + chunk.length + current.length > MAX) {
          chunks.push(current.trim())
          current = chunk
        } else {
          current = current + separator + chunk
        }
      }
    }

    if (current.trim()) chunks.push(current.trim())
    return chunks
  }

  /**
   * Produce a streaming-indicator preview (Telegram HTML).
   *
   * Two display modes:
   *   - Tool-active (no text yet):  ⚙️ Claude is working\n🔧 <b>ToolName</b>
   *   - Text-streaming:             ⚡ Claude is responding...\n\n<escaped partial text>
   *
   * The partial text is stripped of Markdown syntax characters, then HTML-escaped
   * before embedding. This guarantees that unclosed or malformed tags in Claude's
   * streaming output can never corrupt Telegram's HTML parser.
   *
   * @param partialText   - Accumulated text content so far (may be empty during tool-only turns)
   * @param toolActivity  - Current tool being executed, e.g. "Read", "Bash", "Edit" (optional)
   */
  streamingPlaceholder(partialText: string, toolActivity?: string | null): string {
    // Strip Markdown syntax for a readable plain-text preview
    const clean = partialText
      .replace(/```[\s\S]*?```/g, '[code block]')
      .replace(/`[^`]+`/g, '[code]')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim()

    const headerHtml = toolActivity
      ? `⚙️ Claude is working\n🔧 <b>${escapeHtml(toolActivity)}</b>`
      : `⚡ Claude is responding...`

    if (!clean) return headerHtml

    // escapeHtml ensures partial text never breaks Telegram's HTML parser
    const preview = escapeHtml(safeSlice(clean, 0, 300))
    return `${headerHtml}\n\n${preview}${clean.length > 300 ? '…' : ''}`
  }

  /**
   * Extract the name of the most recent tool being used from a list of content blocks.
   * Returns null if no tool_use block is present.
   *
   * Used to show "⚙️ Claude is working... [Bash]" in streaming placeholders.
   */
  extractToolActivity(blocks: ContentBlock[]): string | null {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i]
      if (block.type === 'tool_use') return humanizeToolName(block.name, block.input)
    }
    return null
  }

  // ── Evose Agent progress (Telegram HTML) ──────────────────────────────────

  /**
   * Extract Evose agent activity from the message's content blocks.
   *
   * Scans for ToolUseBlocks that carry `progressBlocks[]` with either
   * `tool_call` or `text` entries. Returns the agent display name,
   * sub-tool calls, and text output — or null if no activity is found.
   *
   * Text blocks are the Evose agent's reasoning / response text,
   * equally important to show alongside tool activity.
   */
  extractEvoseActivity(
    blocks: ContentBlock[],
  ): { agentName: string; toolCalls: EvoseToolCallBlock[]; textBlocks: EvoseTextBlock[] } | null {
    for (const block of blocks) {
      if (block.type !== 'tool_use' || !block.progressBlocks?.length) continue
      const toolCalls = block.progressBlocks.filter(
        (b): b is EvoseToolCallBlock => b.type === 'tool_call',
      )
      const textBlocks = block.progressBlocks.filter(
        (b): b is EvoseTextBlock => b.type === 'text',
      )
      if (toolCalls.length === 0 && textBlocks.length === 0) continue

      return { agentName: humanizeToolName(block.name, block.input), toolCalls, textBlocks }
    }
    return null
  }

  /**
   * Produce an Evose Agent progress placeholder (Telegram HTML).
   *
   * Shows the agent name as header, followed by each sub-tool call with
   * a status emoji and the agent's text output preview. Only the most
   * recent N calls are shown to keep the message compact.
   *
   * Example output:
   *   ⚙️ <b>X Analyst</b> is running
   *
   *   ✅ Twitter Advanced Search
   *   ✅ Web Search
   *   🔄 Content Analysis...
   *
   *   Based on the analysis, the key findings are...
   */
  evoseActivityPlaceholder(
    activity: { agentName: string; toolCalls: EvoseToolCallBlock[]; textBlocks?: EvoseTextBlock[] },
  ): string {
    const STATUS_EMOJI: Record<string, string> = {
      running:   '🔄',
      completed: '✅',
      error:     '❌',
    }

    const header = `⚙️ <b>${escapeHtml(activity.agentName)}</b> is running`

    // Show the most recent N tool calls to keep the message compact.
    // Completed calls beyond the window are summarized as a count.
    const MAX_VISIBLE = 6
    const { toolCalls } = activity
    const total = toolCalls.length
    const visible = toolCalls.slice(-MAX_VISIBLE)
    const hiddenCount = total - visible.length

    const lines = visible.map((tc) => {
      const emoji = STATUS_EMOJI[tc.status] ?? '⚙️'
      return formatEvoseToolCallLine(tc, emoji)
    })

    const parts = [header, '']
    if (hiddenCount > 0) {
      parts.push(`<i>... and ${hiddenCount} more completed steps</i>`)
    }
    parts.push(...lines)

    // Append Evose agent's text output (reasoning / response)
    const textContent = (activity.textBlocks ?? [])
      .map((b) => b.text)
      .join('')
      .trim()

    if (textContent) {
      // Strip Markdown for a clean plain-text preview
      const clean = textContent
        .replace(/```[\s\S]*?```/g, '[code block]')
        .replace(/`[^`]+`/g, '[code]')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim()

      if (clean) {
        const MAX_TEXT_LEN = 800
        const preview = escapeHtml(safeSlice(clean, 0, MAX_TEXT_LEN))
        if (clean.length > MAX_TEXT_LEN) {
          // Include total character count so the rendered content changes as
          // text grows beyond MAX_TEXT_LEN.  Without this, the strategy's
          // content-dedup (`content === lastContent`) would freeze the
          // placeholder once the truncated preview stabilizes — causing the
          // visual "output stops halfway" bug.
          parts.push('', `${preview}…\n<i>📝 ${clean.length} chars generated</i>`)
        } else {
          parts.push('', preview)
        }
      }
    }

    // Safety cap: ensure total HTML ≤ 4000 chars (leaving headroom for
    // Telegram's 4096-char limit — HTML entities and reply_markup don't count).
    const result = parts.join('\n')
    if (result.length > 4000) {
      return result.slice(0, snapToGraphemeBoundary(result, 3990)) + '…'
    }
    return result
  }

  // ── Evose Agent Final Summary (Finalization) ────────────────────────────

  /**
   * Format the Evose progress summary for a finalized message.
   *
   * Called by `formatAssistantBlocks()` for ToolUseBlocks that carry
   * progressBlocks — produces a persistent summary that survives after
   * the streaming placeholder is replaced.
   *
   * Renders: agent name header + completed tool list + text output preview
   */
  formatEvoseSummary(block: ToolUseBlock): string | null {
    if (!block.progressBlocks?.length) return null

    const toolCalls = block.progressBlocks.filter(
      (b): b is EvoseToolCallBlock => b.type === 'tool_call',
    )
    const textBlocks = block.progressBlocks.filter(
      (b): b is EvoseTextBlock => b.type === 'text',
    )
    if (toolCalls.length === 0 && textBlocks.length === 0) return null

    const agentName = humanizeToolName(block.name, block.input)

    const STATUS_EMOJI: Record<string, string> = {
      running:   '🔄',
      completed: '✅',
      error:     '❌',
    }

    const header = `⚙️ <b>${escapeHtml(agentName)}</b>`

    const parts = [header]

    // Tool call summary (compact: only show count if many)
    if (toolCalls.length > 0) {
      const MAX_VISIBLE = 4
      const visible = toolCalls.slice(-MAX_VISIBLE)
      const hiddenCount = toolCalls.length - visible.length

      if (hiddenCount > 0) {
        parts.push(`<i>... and ${hiddenCount} more steps</i>`)
      }
      for (const tc of visible) {
        const emoji = STATUS_EMOJI[tc.status] ?? '⚙️'
        parts.push(formatEvoseToolCallLine(tc, emoji))
      }
    }

    // Text output (preserved for user reference)
    const textContent = textBlocks
      .map((b) => b.text)
      .join('')
      .trim()

    if (textContent) {
      const clean = textContent
        .replace(/```[\s\S]*?```/g, '[code block]')
        .replace(/`[^`]+`/g, '[code]')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim()

      if (clean) {
        const MAX_TEXT_LEN = 800
        const preview = escapeHtml(safeSlice(clean, 0, MAX_TEXT_LEN))
        if (clean.length > MAX_TEXT_LEN) {
          parts.push('', `${preview}…\n<i>📝 ${clean.length} chars total</i>`)
        } else {
          parts.push('', preview)
        }
      }
    }

    // Safety cap: keep within Telegram's 4096-char limit
    const result = parts.join('\n')
    if (result.length > 4000) {
      return result.slice(0, snapToGraphemeBoundary(result, 3990)) + '…'
    }
    return result
  }

  // ── Evose Agent Full Commit HTML (for commitEvoseProgress) ──────────────

  /**
   * Generate the full commit HTML for an Evose Agent result.
   *
   * Unlike `evoseActivityPlaceholder()` which truncates text to keep the
   * streaming placeholder compact, this method produces the complete,
   * untruncated HTML — suitable for the permanent message(s) sent when
   * the Evose progress is committed before Claude's next streaming turn.
   *
   * Key differences from `evoseActivityPlaceholder`:
   *   - Text is NOT truncated — the full Evose output is preserved
   *   - Markdown → Telegram HTML conversion via `convertMarkdownToHtml`
   *     (instead of stripping Markdown to plain text)
   *   - Header has no "is running" suffix (this is the final version)
   *   - Shows up to 8 tool calls (vs 6 for streaming)
   *   - No 4000-char safety cap — caller is responsible for splitting
   *
   * @returns HTML string that may exceed 4096 chars — use `splitForTelegram()`
   */
  evoseCommitHtml(
    activity: { agentName: string; toolCalls: EvoseToolCallBlock[]; textBlocks?: EvoseTextBlock[] },
  ): string {
    const STATUS_EMOJI: Record<string, string> = {
      running:   '🔄',
      completed: '✅',
      error:     '❌',
    }

    const header = `⚙️ <b>${escapeHtml(activity.agentName)}</b>`

    const MAX_VISIBLE = 8
    const { toolCalls } = activity
    const total = toolCalls.length
    const visible = toolCalls.slice(-MAX_VISIBLE)
    const hiddenCount = total - visible.length

    const lines = visible.map((tc) => {
      const emoji = STATUS_EMOJI[tc.status] ?? '⚙️'
      return formatEvoseToolCallLine(tc, emoji)
    })

    const parts = [header, '']
    if (hiddenCount > 0) {
      parts.push(`<i>... and ${hiddenCount} more completed steps</i>`)
    }
    parts.push(...lines)

    // Full text content — Markdown → Telegram HTML conversion (no truncation)
    const textContent = (activity.textBlocks ?? [])
      .map((b) => b.text)
      .join('')
      .trim()

    if (textContent) {
      parts.push('', convertMarkdownToHtml(textContent))
    }

    return parts.join('\n')
  }

  /**
   * Split an HTML string into Telegram-safe chunks (each ≤ 4096 chars).
   *
   * Splits at semantic boundaries: `</pre>`, `\n\n`, `\n` — never inside
   * a `<pre>` code block. Wraps the internal `splitHtmlAtSemanticBoundary`.
   */
  splitForTelegram(html: string): string[] {
    return splitHtmlAtSemanticBoundary(html, 4096)
  }
}
