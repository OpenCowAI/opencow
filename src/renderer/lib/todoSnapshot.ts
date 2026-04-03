// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionMessage, TodoWriteItem } from '@shared/types'

/**
 * Parsed TodoWrite snapshot from assistant content blocks.
 */
export interface TodoSnapshot {
  items: TodoWriteItem[]
  messageId: string
  toolUseId: string
  turnStartMessageId: string | null
}

type TodoSnapshotProbe = TodoSnapshot | 'invalid' | null

function isTodoStatus(value: unknown): value is TodoWriteItem['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function toTodoWriteItem(raw: unknown): TodoWriteItem | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Record<string, unknown>
  if (typeof candidate.content !== 'string') return null
  if (!isTodoStatus(candidate.status)) return null

  const item: TodoWriteItem = {
    content: candidate.content,
    status: candidate.status,
  }
  if (typeof candidate.activeForm === 'string') {
    item.activeForm = candidate.activeForm
  }
  return item
}

function parseTodoWriteItems(value: unknown): TodoWriteItem[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const items: TodoWriteItem[] = []
  for (const raw of value) {
    const item = toTodoWriteItem(raw)
    if (!item) return null
    items.push(item)
  }
  return items
}

function probeTodoSnapshotFromAssistant(
  msg: Extract<ManagedSessionMessage, { role: 'assistant' }>,
  turnStartMessageId: string | null,
): TodoSnapshotProbe {
  for (let j = msg.content.length - 1; j >= 0; j--) {
    const block = msg.content[j]
    if (block.type !== 'tool_use' || block.name !== 'TodoWrite') continue

    const input = block.input as Record<string, unknown> | undefined
    const items = parseTodoWriteItems(input?.todos)
    if (!items) return 'invalid'

    return {
      items,
      messageId: msg.id,
      toolUseId: block.id,
      turnStartMessageId,
    }
  }
  return null
}

function findCurrentTurnStartIndex(messages: ManagedSessionMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return 0
}

/**
 * Find the latest TodoWrite snapshot within the current turn.
 *
 * "Current turn" is scoped from the latest user message (inclusive) to the end.
 * This prevents stale todos from previous turns from leaking into the footer.
 */
export function getLatestTodoSnapshotInCurrentTurn(
  messages: ManagedSessionMessage[],
): TodoSnapshot | null {
  return getLatestTodoSnapshotInCurrentTurnWithOverlay(messages, null)
}

/**
 * Overlay-aware variant used by store-level derivation.
 *
 * `overlay` represents the latest assistant message snapshot that may not yet
 * be merged into the structural message array.
 */
export function getLatestTodoSnapshotInCurrentTurnWithOverlay(
  messages: ManagedSessionMessage[],
  overlay: ManagedSessionMessage | null,
): TodoSnapshot | null {
  if (messages.length === 0) return null

  const turnStartIdx = findCurrentTurnStartIndex(messages)
  const turnStartMessageId = messages[turnStartIdx]?.id ?? null
  const overlayId = overlay?.id ?? null

  if (overlay?.role === 'assistant') {
    const overlayProbe = probeTodoSnapshotFromAssistant(overlay, turnStartMessageId)
    if (overlayProbe === 'invalid') return null
    if (overlayProbe) return overlayProbe
  }

  for (let i = messages.length - 1; i >= turnStartIdx; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    if (overlayId && msg.id === overlayId) continue

    const probe = probeTodoSnapshotFromAssistant(msg, turnStartMessageId)
    if (probe === 'invalid') return null
    if (probe) return probe
  }

  return null
}

/**
 * Whether a todo snapshot contains at least one actionable item.
 */
export function hasOpenTodos(items: readonly TodoWriteItem[]): boolean {
  return items.some((item) => item.status !== 'completed')
}
