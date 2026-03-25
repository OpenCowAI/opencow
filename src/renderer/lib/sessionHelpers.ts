// SPDX-License-Identifier: Apache-2.0

/**
 * Shared helpers for working with managed session data.
 *
 * Extracted from AgentChatView / SessionPanel / SkillCreatorView
 * to eliminate cross-file duplication.
 */

import type { ManagedSessionMessage, ContentBlock } from '@shared/types'

// ─── TodoItem ────────────────────────────────────────────────────────────────

/**
 * TodoItem shape as produced by the `TodoWrite` tool_use block.
 * Re-exported here so consumers don't need to reach into TodoWidgets.
 */
export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

// ─── getLatestTodos ──────────────────────────────────────────────────────────

/**
 * Extract the latest TodoWrite todos from session messages (reverse scan).
 * Returns `null` if no TodoWrite block is found or if all tasks are completed.
 *
 * Accepts `ManagedSessionMessage[]` directly — no `as any` casting needed.
 */
export function getLatestTodos(messages: ManagedSessionMessage[]): TodoItem[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j]
      if (block.type === 'tool_use' && block.name === 'TodoWrite') {
        const input = block.input as Record<string, unknown> | undefined
        const todos = input?.todos
        if (!Array.isArray(todos) || todos.length === 0) return null
        const items = todos as TodoItem[]
        // Hide when all tasks are completed
        if (items.every((t) => t.status === 'completed')) return null
        return items
      }
    }
  }
  return null
}

// ─── Active duration ─────────────────────────────────────────────────────────

/**
 * Snapshot of a session's active-time tracking state.
 *
 * Active duration = time spent in "working" states (creating / streaming / stopping).
 * Idle and waiting periods are **excluded**.
 *
 * This is a value object — pass it around instead of flat `(ms, startedAt)` pairs.
 */
export interface ActiveDuration {
  /** Cumulative active time already settled (ms). */
  accumulatedMs: number
  /** Epoch ms when the current active segment started; `null` when not active. */
  activeStartedAt: number | null
}

/**
 * Extract an `ActiveDuration` value object from any source that carries
 * the two raw fields (`activeDurationMs` + `activeStartedAt`).
 *
 * This bridges the field-name gap between `SessionSnapshot`
 * (flat `activeDurationMs`) and the structured `ActiveDuration` type
 * (semantic `accumulatedMs`), eliminating boilerplate mapping at every call site.
 */
export function toActiveDuration(
  source: { activeDurationMs: number; activeStartedAt: number | null },
): ActiveDuration {
  return { accumulatedMs: source.activeDurationMs, activeStartedAt: source.activeStartedAt }
}

/**
 * Compute the real-time cumulative active duration in milliseconds.
 *
 * When the session is currently active (`activeStartedAt != null`),
 * the in-flight segment is added on top of the accumulated total.
 */
export function computeActiveDuration(duration: ActiveDuration): number {
  if (duration.activeStartedAt != null) {
    return duration.accumulatedMs + (Date.now() - duration.activeStartedAt)
  }
  return duration.accumulatedMs
}

// ─── formatDuration ──────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds into a compact human-readable string.
 *
 * Examples: `"0s"`, `"45s"`, `"3m"`, `"3m 12s"`
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

// ─── extractTextContent ──────────────────────────────────────────────────────

/**
 * Extract and join all `text` blocks from a message's content array.
 *
 * Filters for `type === 'text'` blocks, concatenates their text with the
 * given separator, and trims whitespace.  Returns empty string when no
 * text content is found.
 *
 * @param separator  Join character — defaults to `' '`.  Use `'\n'` for
 *                   multi-line display (e.g. sticky question banners).
 */
export function extractTextContent(
  blocks: ContentBlock[],
  separator = ' ',
): string {
  return blocks
    .filter((b: ContentBlock) => b.type === 'text')
    .map((b: ContentBlock) => (b as { type: 'text'; text: string }).text)
    .join(separator)
    .trim()
}
