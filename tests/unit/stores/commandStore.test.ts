// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useCommandStore, selectLatestOpenTodos } from '../../../src/renderer/stores/commandStore'
import { makeManagedSession } from '../../helpers'
import type { ManagedSessionMessage } from '../../../src/shared/types'

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => new Proxy({}, {
    get: () => vi.fn().mockResolvedValue(null),
  }),
}))

function makeAssistantMessage(params: {
  id: string
  isStreaming: boolean
  activeToolUseId?: string | null
  text?: string
}): ManagedSessionMessage {
  return {
    id: params.id,
    role: 'assistant',
    content: [{ type: 'text', text: params.text ?? params.id }],
    timestamp: 1_700_000_000_000,
    isStreaming: params.isStreaming,
    ...(params.activeToolUseId !== undefined ? { activeToolUseId: params.activeToolUseId } : {}),
  }
}

describe('commandStore.batchAppendSessionMessages', () => {
  beforeEach(() => {
    useCommandStore.getState().reset()
  })

  it('keeps non-overlay assistant updates in structural list when multiple assistant updates arrive in one batch', () => {
    const sessionId = 'session-1'
    const baseA = makeAssistantMessage({
      id: 'assistant-a',
      isStreaming: false,
      activeToolUseId: 'tool-a',
      text: 'A old',
    })
    const baseB = makeAssistantMessage({
      id: 'assistant-b',
      isStreaming: true,
      activeToolUseId: 'tool-b',
      text: 'B old',
    })

    const snapshot = makeManagedSession({
      id: sessionId,
      state: 'streaming',
      messages: [baseA, baseB],
    })

    useCommandStore.setState({
      managedSessions: [snapshot],
      sessionById: { [sessionId]: snapshot },
      sessionMessages: { [sessionId]: [baseA, baseB] },
      // Overlay points to assistant-b (single-slot model)
      streamingMessageBySession: { [sessionId]: baseB },
      activeManagedSessionId: sessionId,
    })

    const updatedA = makeAssistantMessage({
      id: 'assistant-a',
      isStreaming: false,
      activeToolUseId: null,
      text: 'A finalized',
    })
    const updatedB = makeAssistantMessage({
      id: 'assistant-b',
      isStreaming: false,
      activeToolUseId: null,
      text: 'B finalized',
    })

    useCommandStore.getState().batchAppendSessionMessages(
      new Map([[sessionId, [updatedA, updatedB]]]),
    )

    const storeAfterBatch = useCommandStore.getState()
    const listAfterBatch = storeAfterBatch.sessionMessages[sessionId] ?? []
    const overlayAfterBatch = storeAfterBatch.streamingMessageBySession[sessionId]

    const aAfterBatch = listAfterBatch.find((m) => m.id === 'assistant-a')
    const bAfterBatch = listAfterBatch.find((m) => m.id === 'assistant-b')

    // assistant-a (non-overlay id) must be written structurally immediately.
    expect(aAfterBatch?.role).toBe('assistant')
    expect((aAfterBatch as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.activeToolUseId).not.toBe('tool-a')
    expect((aAfterBatch as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.isStreaming).toBe(false)
    expect((aAfterBatch as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.content[0]).toEqual({
      type: 'text',
      text: 'A finalized',
    })

    // assistant-b (overlay id) still uses fast path and lives in overlay until merge.
    expect((bAfterBatch as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.content[0]).toEqual({
      type: 'text',
      text: 'B old',
    })
    expect(overlayAfterBatch?.id).toBe('assistant-b')
    expect((overlayAfterBatch as Extract<ManagedSessionMessage, { role: 'assistant' }> | null)?.isStreaming).toBe(false)
    expect((overlayAfterBatch as Extract<ManagedSessionMessage, { role: 'assistant' }> | null)?.activeToolUseId).not.toBe('tool-b')

    useCommandStore.getState().mergeStreamingOverlay(sessionId)

    const storeAfterMerge = useCommandStore.getState()
    const listAfterMerge = storeAfterMerge.sessionMessages[sessionId] ?? []
    const aAfterMerge = listAfterMerge.find((m) => m.id === 'assistant-a')
    const bAfterMerge = listAfterMerge.find((m) => m.id === 'assistant-b')

    expect((aAfterMerge as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.content[0]).toEqual({
      type: 'text',
      text: 'A finalized',
    })
    expect((bAfterMerge as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.content[0]).toEqual({
      type: 'text',
      text: 'B finalized',
    })
    expect((bAfterMerge as Extract<ManagedSessionMessage, { role: 'assistant' }> | undefined)?.activeToolUseId).not.toBe('tool-b')
    expect(storeAfterMerge.streamingMessageBySession[sessionId]).toBeNull()
  })

  it('derives latest open todos from current turn and overlay', () => {
    const sessionId = 'session-todo'
    const snapshot = makeManagedSession({
      id: sessionId,
      state: 'streaming',
      messages: [],
    })

    useCommandStore.setState({
      managedSessions: [snapshot],
      sessionById: { [sessionId]: snapshot },
      sessionMessages: {
        [sessionId]: [
          {
            id: 'u1',
            role: 'user',
            timestamp: 1,
            content: [{ type: 'text', text: 'turn1' }],
          },
          {
            id: 'a1',
            role: 'assistant',
            timestamp: 2,
            content: [
              {
                type: 'tool_use',
                id: 'todo-1',
                name: 'TodoWrite',
                input: {
                  todos: [
                    { content: 'old', status: 'pending' },
                  ],
                },
              },
            ],
            isStreaming: false,
          },
          {
            id: 'u2',
            role: 'user',
            timestamp: 3,
            content: [{ type: 'text', text: 'turn2' }],
          },
        ],
      },
      streamingMessageBySession: {
        [sessionId]: {
          id: 'a2',
          role: 'assistant',
          timestamp: 4,
          isStreaming: true,
          content: [
            {
              type: 'tool_use',
              id: 'todo-2',
              name: 'TodoWrite',
              input: {
                todos: [
                  { content: 'new', status: 'pending' },
                ],
              },
            },
          ],
        },
      },
      latestTodosBySession: {},
      activeManagedSessionId: sessionId,
    })

    const derived = selectLatestOpenTodos(useCommandStore.getState(), sessionId)
    expect(derived).toEqual([{ content: 'new', status: 'pending' }])
  })
})
