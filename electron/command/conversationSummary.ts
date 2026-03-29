// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionMessage, AIEngineKind, ContentBlock } from '../../src/shared/types'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ConversationSummaryParams {
  /** Read-only message array from ManagedSession.getMessages(). */
  messages: readonly ManagedSessionMessage[]
  /** Engine that produced these messages (for attribution in the summary). */
  fromEngine: AIEngineKind
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Maximum characters per assistant turn in the summary. */
const ASSISTANT_TURN_LIMIT = 300
/** Total character budget for the entire summary body. */
const TOTAL_BUDGET = 4000
/** When over budget: keep first N + last N turns with ellipsis. */
const HEAD_TURNS = 2
const TAIL_TURNS = 2

// ─── Implementation ────────────────────────────────────────────────────────

/**
 * Build a structured summary of prior conversation turns for injection into
 * the new engine's system prompt context.
 *
 * Design constraints:
 * - Pure function — no I/O, no side effects
 * - Extracts only text content (skips tool_use / tool_result blocks)
 * - Truncates assistant responses to keep the summary compact
 * - Total budget capped at ~4000 chars; over-budget uses head+tail strategy
 * - Output wrapped in XML tags for clear delineation in system prompt
 */
export function buildConversationSummary(params: ConversationSummaryParams): string {
  const { messages, fromEngine } = params

  // 1. Extract user/assistant text turns (skip system events)
  const turns: Array<{ role: 'user' | 'assistant'; text: string }> = []
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue
    const text = extractTextFromBlocks(msg.content)
    if (!text) continue
    turns.push({
      role: msg.role,
      text: msg.role === 'assistant' ? truncate(text, ASSISTANT_TURN_LIMIT) : text,
    })
  }

  if (turns.length === 0) return ''

  // 2. Format turns, applying head+tail truncation if over budget
  const formatted = formatTurns(turns)

  // 3. Wrap in XML context block
  return [
    `<prior-conversation engine="${fromEngine}">`,
    'The following is a summary of the prior conversation with a different AI engine.',
    'Continue from where the conversation left off.',
    '',
    formatted,
    '</prior-conversation>',
  ].join('\n')
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractTextFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\u2026'
}

function formatTurns(turns: Array<{ role: string; text: string }>): string {
  const lines: string[] = []
  let turnNumber = 0

  for (const turn of turns) {
    if (turn.role === 'user') turnNumber++
    lines.push(`[Turn ${turnNumber}] ${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`)
  }

  const full = lines.join('\n')
  if (full.length <= TOTAL_BUDGET) return full

  // Over budget: head + ellipsis + tail
  const headLines = lines.slice(0, HEAD_TURNS * 2)
  const tailLines = lines.slice(-TAIL_TURNS * 2)
  return [...headLines, '', '[... earlier turns omitted for brevity ...]', '', ...tailLines].join('\n')
}
