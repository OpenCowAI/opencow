// SPDX-License-Identifier: Apache-2.0

/**
 * Content preparation for memory extraction.
 *
 * Builds extraction content from full session messages using a
 * "recent-turns-first" strategy for long conversations:
 *
 * - Short conversations (within budget): everything preserved as-is
 * - Long conversations: latest 2 turns fully preserved,
 *   older turns have assistant messages truncated to 200 chars
 *
 * Design rationale:
 * - User messages are the primary source of memory-worthy content and are
 *   ALWAYS preserved in full across all turns.
 * - Assistant messages in the latest 2 turns are preserved in full because
 *   user referential expressions ("I agree", "that won't work") typically
 *   reference the immediately preceding assistant response.
 * - Older assistant messages are truncated because their detailed content
 *   (code blocks, long explanations) has already been "digested" by
 *   subsequent conversation turns.
 *
 * References:
 * - DeerFlow / OpenMemory: process full conversation
 * - Mem0: "GENERATE FACTS SOLELY BASED ON THE USER'S MESSAGES"
 * - Apple PLUM: user conversations as primary personalization source
 */

/** Max characters to keep from each assistant message in older turns. */
const ASSISTANT_TRUNCATE_CHARS = 200

/** Number of most recent turns to preserve in full (user + assistant). */
const FULL_PRESERVE_RECENT_TURNS = 2

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Minimal message shape for extraction.
 *
 * Uses a permissive signature to accept ManagedSessionMessage (a discriminated
 * union where 'system' messages have no `content` field). The extraction logic
 * filters by role and handles missing content gracefully.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- permissive input
type SessionMessage = { role: string } & Record<string, unknown>

/** A turn = 1 user message + 0-1 assistant responses. */
interface Turn {
  userText: string
  assistantText: string
  /**
   * True when the user message contained `slash_command` content blocks.
   *
   * Command-driven turns have fundamentally different assistant semantics:
   * the assistant is executing a command template (code review, commit analysis,
   * etc.), NOT responding to user preferences. The assistant response in these
   * turns is omitted from extraction content to prevent false memory extraction.
   *
   * The user's own text blocks are always preserved — user preferences expressed
   * alongside a slash command (e.g., "我偏好 strict TS") are self-descriptive
   * and don't require the assistant's command output for the extraction LLM to
   * understand them.
   */
  isCommandDriven: boolean
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Prepare session messages for memory extraction.
 *
 * Strategy:
 *   1. Group messages into turns (user question + assistant response)
 *   2. If total text is within budget → return as-is
 *   3. If over budget → apply recent-turns-first compression
 *   4. If still over budget → truncate (Phase 2: LLM summarization)
 *
 * @param messages - Full session message array
 * @param maxChars - Character budget
 * @returns Formatted conversation text, or null if too short
 */
export function prepareExtractionContent(
  messages: SessionMessage[],
  maxChars: number,
): string | null {
  const turns = groupIntoTurns(messages)
  if (turns.length === 0) return null

  // Try full text first — if within budget, no compression needed
  const fullText = formatTurns(turns, false)
  if (fullText.length < 30) return null
  if (fullText.length <= maxChars) return fullText

  // Apply recent-turns-first compression
  const compressed = formatTurns(turns, true)
  if (compressed.length <= maxChars) return compressed

  // Still over budget — truncate (Phase 2 will use LLM summarization)
  return compressed.slice(0, maxChars)
}

/**
 * Build a summarization prompt for very long conversations.
 *
 * Instructs the LLM to compress the conversation while preserving
 * all information relevant to memory extraction.
 *
 * Used in Phase 2 (after HeadlessLLMClient is available) when even
 * the compressed format exceeds the character budget.
 */
export function buildSummarizationPrompt(conversationText: string): string {
  return `Summarize this conversation, preserving ALL of the following information types if present:

- User's personal background (role, experience, skills, identity)
- User's preferences (tools, coding style, design taste, communication style)
- User's behavioral patterns (recurring habits, workflow choices)
- Project decisions (architecture, tech stack, conventions, goals)
- Domain knowledge the user shared
- Opinions and lessons learned the user expressed
- What the user agreed with or rejected from the assistant's suggestions

Rules:
- Preserve SPECIFIC details — "10 years Go experience" not "experienced developer"
- When the user references the assistant's prior response (e.g. "I agree", "that won't work"),
  include enough of the assistant's point so the reference is understandable
- DO NOT include procedural details (which files were edited, tool outputs, code diffs)
- DO NOT include greetings, filler, or task-specific troubleshooting steps
- Keep the summary under 3000 characters
- Write in third person ("The user...", "The project...")

## Conversation

${conversationText}`
}

// ─── Internal ────────────────────────────────────────────────────────

/**
 * Group flat message array into logical turns.
 *
 * A turn starts with a user message and includes subsequent assistant messages.
 * Multiple consecutive assistant messages within the same turn are concatenated.
 */
function groupIntoTurns(messages: SessionMessage[]): Turn[] {
  const turns: Turn[] = []
  let currentUserText = ''
  let currentAssistantText = ''
  let currentIsCommandDriven = false

  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue

    const text = extractText(msg)
    if (!text) continue

    if (msg.role === 'user') {
      // Flush previous turn if exists
      if (currentUserText) {
        turns.push({ userText: currentUserText, assistantText: currentAssistantText, isCommandDriven: currentIsCommandDriven })
      }
      currentUserText = text
      currentAssistantText = ''
      currentIsCommandDriven = hasSlashCommandBlock(msg)
    } else {
      currentAssistantText += (currentAssistantText ? '\n' : '') + text
    }
  }

  // Flush last turn
  if (currentUserText) {
    turns.push({ userText: currentUserText, assistantText: currentAssistantText, isCommandDriven: currentIsCommandDriven })
  }

  return turns
}

/**
 * Format turns into conversation text.
 *
 * @param compress - If true, apply recent-turns-first compression:
 *   latest FULL_PRESERVE_RECENT_TURNS turns fully preserved,
 *   older turns have assistant messages truncated.
 */
function formatTurns(turns: Turn[], compress: boolean): string {
  const lines: string[] = []

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    const isRecentTurn = i >= turns.length - FULL_PRESERVE_RECENT_TURNS

    // User messages: always fully preserved
    lines.push(`User: ${turn.userText}`)

    if (!turn.assistantText) continue

    // Command-driven turns: the assistant is executing a slash-command template
    // (code review, commit analysis, etc.), not responding to user preferences.
    // Drop the assistant response to prevent the extraction LLM from confusing
    // template-driven output with user-expressed preferences.
    if (turn.isCommandDriven) continue

    if (!compress || isRecentTurn) {
      lines.push(`Assistant: ${turn.assistantText}`)
    } else {
      const truncated = turn.assistantText.length > ASSISTANT_TRUNCATE_CHARS
        ? turn.assistantText.slice(0, ASSISTANT_TRUNCATE_CHARS) + '…'
        : turn.assistantText
      lines.push(`Assistant: ${truncated}`)
    }
  }

  return lines.join('\n')
}

/** Check whether a user message contains at least one slash_command content block. */
function hasSlashCommandBlock(msg: SessionMessage): boolean {
  const content = (msg as Record<string, unknown>).content
  if (!Array.isArray(content)) return false
  return content.some(
    (block) => typeof block === 'object' && block !== null && block.type === 'slash_command',
  )
}

/** Extract text from content blocks, joining multiple text blocks. */
function extractText(msg: SessionMessage): string {
  const content = (msg as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'object' && block !== null && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n')
}
