// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  getLatestTodoSnapshotInCurrentTurn,
  getLatestTodoSnapshotInCurrentTurnWithOverlay,
  hasOpenTodos,
} from '../../../src/renderer/lib/todoSnapshot'
import type { ManagedSessionMessage } from '../../../src/shared/types'

function userMsg(id: string, text: string): ManagedSessionMessage {
  return {
    id,
    role: 'user',
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
  }
}

function assistantTodoMsg(
  id: string,
  todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }>,
): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    timestamp: Date.now(),
    content: [
      {
        type: 'tool_use',
        id: `${id}-todo`,
        name: 'TodoWrite',
        input: { todos },
      },
    ],
  }
}

describe('todoSnapshot', () => {
  it('extracts latest TodoWrite from current turn only', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'first'),
      assistantTodoMsg('a1', [{ content: 'old', status: 'in_progress' }]),
      userMsg('u2', 'second'),
      assistantTodoMsg('a2', [{ content: 'new', status: 'pending' }]),
    ]

    const snapshot = getLatestTodoSnapshotInCurrentTurn(messages)
    expect(snapshot?.messageId).toBe('a2')
    expect(snapshot?.toolUseId).toBe('a2-todo')
    expect(snapshot?.turnStartMessageId).toBe('u2')
    expect(snapshot?.items).toEqual([{ content: 'new', status: 'pending' }])
  })

  it('returns null for invalid TodoWrite payload', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'turn'),
      {
        id: 'a1',
        role: 'assistant',
        timestamp: Date.now(),
        content: [
          {
            type: 'tool_use',
            id: 'a1-todo',
            name: 'TodoWrite',
            input: { todos: [{ content: 'broken', status: 'done' }] },
          },
        ],
      },
    ]

    expect(getLatestTodoSnapshotInCurrentTurn(messages)).toBeNull()
  })

  it('checks open/completed todo set correctly', () => {
    expect(hasOpenTodos([
      { content: 'A', status: 'completed' },
      { content: 'B', status: 'completed' },
    ])).toBe(false)

    expect(hasOpenTodos([
      { content: 'A', status: 'completed' },
      { content: 'B', status: 'pending' },
    ])).toBe(true)
  })

  it('prefers overlay snapshot over structural messages in same turn', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'turn'),
      assistantTodoMsg('a1', [{ content: 'old', status: 'pending' }]),
    ]
    const overlay: ManagedSessionMessage = {
      id: 'a1',
      role: 'assistant',
      timestamp: Date.now(),
      isStreaming: true,
      content: [
        {
          type: 'tool_use',
          id: 'a1-todo',
          name: 'TodoWrite',
          input: { todos: [{ content: 'new', status: 'pending' }] },
        },
      ],
    }

    const snapshot = getLatestTodoSnapshotInCurrentTurnWithOverlay(messages, overlay)
    expect(snapshot?.items).toEqual([{ content: 'new', status: 'pending' }])
  })
})
