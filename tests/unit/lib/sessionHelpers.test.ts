// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { getLatestTodos } from '../../../src/renderer/lib/sessionHelpers'
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

describe('getLatestTodos', () => {
  it('returns latest todos in current turn', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'first turn'),
      assistantTodoMsg('a1', [
        { content: 'old task', status: 'in_progress' },
      ]),
      userMsg('u2', 'second turn'),
      assistantTodoMsg('a2', [
        { content: 'new task', status: 'in_progress' },
        { content: 'next task', status: 'pending' },
      ]),
    ]

    expect(getLatestTodos(messages)).toEqual([
      { content: 'new task', status: 'in_progress' },
      { content: 'next task', status: 'pending' },
    ])
  })

  it('does not leak previous-turn TodoWrite when current turn has no todos', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'first turn'),
      assistantTodoMsg('a1', [
        { content: 'old task', status: 'in_progress' },
      ]),
      userMsg('u2', 'second turn'),
      {
        id: 'a2',
        role: 'assistant',
        timestamp: Date.now(),
        content: [{ type: 'text', text: 'All done' }],
      },
    ]

    expect(getLatestTodos(messages)).toBeNull()
  })

  it('hides todos when all are completed', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'turn'),
      assistantTodoMsg('a1', [
        { content: 'task A', status: 'completed' },
        { content: 'task B', status: 'completed' },
      ]),
    ]

    expect(getLatestTodos(messages)).toBeNull()
  })

  it('hides stale in-progress todos after natural completion', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'turn'),
      assistantTodoMsg('a1', [
        { content: 'task A', status: 'in_progress' },
        { content: 'task B', status: 'pending' },
      ]),
      {
        id: 'a2',
        role: 'assistant',
        timestamp: Date.now(),
        content: [{ type: 'text', text: 'Completed successfully.' }],
      },
    ]

    // Still shown until a subsequent TodoWrite (or engine-side finalization)
    // marks items completed. Session stop reason must not force-hide real tasks.
    expect(getLatestTodos(messages)).toEqual([
      { content: 'task A', status: 'in_progress' },
      { content: 'task B', status: 'pending' },
    ])
  })

  it('returns null when latest current-turn TodoWrite has all items completed', () => {
    const messages: ManagedSessionMessage[] = [
      userMsg('u1', 'turn'),
      assistantTodoMsg('a1', [
        { content: 'task A', status: 'in_progress' },
        { content: 'task B', status: 'pending' },
      ]),
      assistantTodoMsg('a2', [
        { content: 'task A', status: 'completed' },
        { content: 'task B', status: 'completed' },
      ]),
    ]

    expect(getLatestTodos(messages)).toBeNull()
  })
})
