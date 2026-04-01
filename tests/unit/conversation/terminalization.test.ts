// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { terminalizeSession } from '../../../electron/conversation/projection/terminalization'
import type { SessionContext } from '../../../electron/command/sessionContext'
import type { ManagedSessionMessage } from '../../../src/shared/types'

function makeAssistantMessage(id: string, options?: { isStreaming?: boolean; activeToolUseId?: string | null }): ManagedSessionMessage {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text: id }],
    timestamp: Date.now(),
    isStreaming: options?.isStreaming ?? false,
    activeToolUseId: options?.activeToolUseId,
  }
}

function createContext(params?: {
  streamMessageId?: string | null
  messages?: ManagedSessionMessage[]
}): SessionContext & {
  dispatchMessageById: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
  session: {
    getMessages: ReturnType<typeof vi.fn>
    setActiveToolUseId: ReturnType<typeof vi.fn>
    finalizeStreamingMessage: ReturnType<typeof vi.fn>
    transition: ReturnType<typeof vi.fn>
    snapshot: ReturnType<typeof vi.fn>
    origin: { source: 'issue' }
  }
} {
  const messages = params?.messages ?? []
  const streamMessageId = params?.streamMessageId ?? null

  const session = {
    origin: { source: 'issue' as const },
    getMessages: vi.fn(() => messages),
    setActiveToolUseId: vi.fn(),
    finalizeStreamingMessage: vi.fn(),
    transition: vi.fn(),
    snapshot: vi.fn(() => ({
      totalCostUsd: 0,
      stopReason: 'completed',
      origin: { source: 'issue' as const },
      error: null,
    })),
  }

  const dispatch = vi.fn()
  const dispatchMessageById = vi.fn()

  return {
    session,
    sessionId: 'session-1',
    dispatch,
    dispatchMessageById,
    dispatchSessionUpdated: vi.fn(),
    dispatchLastMessage: vi.fn(),
    queueMessageDispatch: vi.fn(),
    timers: { cancel: vi.fn(), set: vi.fn() },
    throttle: { flushNow: vi.fn(), scheduleSession: vi.fn(), scheduleMessage: vi.fn(), scheduleProgress: vi.fn() },
    buffer: {
      isActive: false,
      begin: vi.fn(),
      updateBlocks: vi.fn(),
      setActiveToolUseId: vi.fn(),
      appendToolProgress: vi.fn(),
      getSnapshot: vi.fn(() => null),
      finalize: vi.fn(() => null),
      clear: vi.fn(),
    },
    stream: { finalizeStreaming: vi.fn(() => streamMessageId) },
    relay: { clear: vi.fn() },
    onResultReceived: vi.fn(),
    persistSession: vi.fn(() => Promise.resolve()),
    isSessionAlive: vi.fn(() => true),
  } as unknown as SessionContext & {
    dispatchMessageById: ReturnType<typeof vi.fn>
    dispatch: ReturnType<typeof vi.fn>
    session: {
      getMessages: ReturnType<typeof vi.fn>
      setActiveToolUseId: ReturnType<typeof vi.fn>
      finalizeStreamingMessage: ReturnType<typeof vi.fn>
      transition: ReturnType<typeof vi.fn>
      snapshot: ReturnType<typeof vi.fn>
      origin: { source: 'issue' }
    }
  }
}

describe('terminalizeSession', () => {
  it('dispatches all assistant messages touched by activeToolUseId cleanup before terminal event', () => {
    const messages: ManagedSessionMessage[] = [
      makeAssistantMessage('assistant-stream', { isStreaming: true, activeToolUseId: 'tool-1' }),
      makeAssistantMessage('assistant-other', { isStreaming: false, activeToolUseId: 'tool-2' }),
    ]
    const ctx = createContext({
      streamMessageId: 'assistant-stream',
      messages,
    })

    terminalizeSession({
      ctx,
      input: {
        reason: 'turn_result',
        transition: { type: 'turn_completed', stopReason: 'completed' },
        terminalEvent: 'idle',
        stopReason: 'completed',
        shouldPersist: false,
        shouldNotifyResultReceived: false,
        flushPendingDispatches: false,
      },
    })

    // Stream message finalized and dispatched
    expect(ctx.session.finalizeStreamingMessage).toHaveBeenCalledWith('assistant-stream')
    expect(ctx.dispatchMessageById).toHaveBeenCalledWith('assistant-stream')

    // Non-stream assistant touched by cleanup must also be dispatched
    expect(ctx.session.setActiveToolUseId).toHaveBeenCalledWith('assistant-other', null)
    expect(ctx.dispatchMessageById).toHaveBeenCalledWith('assistant-other')

    const callOrder = ctx.dispatchMessageById.mock.calls.map(([id]: [string]) => id)
    expect(callOrder).toEqual(['assistant-stream', 'assistant-other'])

    // Terminal event still emitted
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command:session:idle' }),
    )
  })
})
