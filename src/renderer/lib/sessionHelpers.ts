// SPDX-License-Identifier: Apache-2.0

/**
 * Shared helpers for working with managed session data.
 *
 * Extracted from AgentChatView / SessionPanel / SkillCreatorView
 * to eliminate cross-file duplication.
 */

import type { ManagedSessionMessage, ContentBlock, TodoWriteItem } from '@shared/types'
import { getLatestTodoSnapshotInCurrentTurn, hasOpenTodos } from './todoSnapshot'

// ─── TodoItem ────────────────────────────────────────────────────────────────

// Canonical todo item alias for backward-compatible renderer imports.
export type TodoItem = TodoWriteItem

// ─── getLatestTodos ──────────────────────────────────────────────────────────

/**
 * Extract the latest TodoWrite todos from the CURRENT turn.
 * Returns `null` when no snapshot exists or all items are completed.
 *
 * Accepts `ManagedSessionMessage[]` directly — no `as any` casting needed.
 */
export function getLatestTodos(messages: ManagedSessionMessage[]): TodoItem[] | null {
  const snapshot = getLatestTodoSnapshotInCurrentTurn(messages)
  if (!snapshot) return null
  if (!hasOpenTodos(snapshot.items)) return null
  return snapshot.items
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
