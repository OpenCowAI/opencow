// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { applyConversationDomainEffects } from '../../../electron/conversation/projection/effectProjector'
import type { ConversationDomainEffect } from '../../../electron/conversation/domain/effects'
import type { SessionContext } from '../../../electron/command/sessionContext'

function makeTurnResultEffect(params?: {
  outcome?: 'success' | 'max_turns' | 'execution_error' | 'budget_exceeded' | 'structured_output_error'
  result?: string
  errors?: string[]
}): ConversationDomainEffect {
  return {
    type: 'apply_turn_result',
    payload: {
      outcome: params?.outcome ?? 'success',
      ...(params?.errors ? { errors: params.errors } : {}),
      ...(params?.result ? { result: params.result } : {}),
    },
  }
}

function makeContext(params: { engineKind: 'claude' | 'codex' }) {
  const session = {
    origin: { source: 'issue' },
    recordTurnUsage: vi.fn(),
    getEngineKind: vi.fn(() => params.engineKind),
    applyContextSnapshot: vi.fn(() => true),
    clearContextState: vi.fn(),
    addSystemEvent: vi.fn(() => 'sys-1'),
    setActivity: vi.fn(),
    updateSystemEventById: vi.fn(),
    finalizeStreamingMessage: vi.fn(),
    getMessages: vi.fn(() => []),
    setActiveToolUseId: vi.fn(),
    setCostUsd: vi.fn(),
    setFinalTokenUsage: vi.fn(),
    setContextLimitFromModelUsage: vi.fn(),
    getContextUsedTokens: vi.fn(() => 0),
    getModel: vi.fn(() => 'test-model'),
    transition: vi.fn(),
    snapshot: vi.fn(() => ({
      totalCostUsd: 0,
      origin: { source: 'issue' },
      error: 'fallback error',
    })),
  }

  return {
    session,
    dispatchSessionUpdated: vi.fn(),
    dispatchLastMessage: vi.fn(),
    dispatchMessageById: vi.fn(),
    queueMessageDispatch: vi.fn(),
    dispatch: vi.fn(),
    timers: { cancel: vi.fn(), set: vi.fn() },
    throttle: { scheduleSession: vi.fn(), scheduleMessage: vi.fn(), scheduleProgress: vi.fn(), flushNow: vi.fn() },
    buffer: { isActive: false, begin: vi.fn(), updateBlocks: vi.fn(), setActiveToolUseId: vi.fn(), appendToolProgress: vi.fn(), getSnapshot: vi.fn(() => null), finalize: vi.fn(() => null), clear: vi.fn() },
    stream: { finalizeStreaming: vi.fn(() => null) },
    relay: { clear: vi.fn() },
    onResultReceived: vi.fn(),
    persistSession: vi.fn(() => Promise.resolve()),
    sessionId: 'session-1',
    isSessionAlive: vi.fn(() => true),
  } as unknown as SessionContext & {
    session: typeof session
    dispatchSessionUpdated: ReturnType<typeof vi.fn>
  }
}

describe('applyConversationDomainEffects', () => {
  it('apply_turn_usage only does token accounting — no context tracking', () => {
    const ctx = makeContext({ engineKind: 'codex' })
    const effects: ConversationDomainEffect[] = [
      {
        type: 'apply_turn_usage',
        payload: {
          inputTokens: 120,
          outputTokens: 20,
          cacheReadInputTokens: 30,
          cacheCreationInputTokens: 0,
        },
      },
    ]

    applyConversationDomainEffects({ effects, ctx })

    expect(ctx.session.recordTurnUsage).toHaveBeenCalledWith(120, 20)
    // Context tracking is now handled by context.snapshot, NOT turn.usage
    expect(ctx.session.applyContextSnapshot).not.toHaveBeenCalled()
  })

  it('applies context.snapshot with authoritative confidence', () => {
    const ctx = makeContext({ engineKind: 'codex' })
    const effects: ConversationDomainEffect[] = [
      {
        type: 'apply_context_snapshot',
        payload: {
          usedTokens: 1024,
          limitTokens: 272000,
          remainingTokens: 270976,
          remainingPct: 99.62,
          source: 'codex.token_count',
          confidence: 'authoritative',
          updatedAtMs: 1_710_000_000_000,
        },
      },
    ]

    applyConversationDomainEffects({ effects, ctx })

    expect(ctx.session.applyContextSnapshot).toHaveBeenCalledWith({
      usedTokens: 1024,
      limitTokens: 272000,
      source: 'codex.token_count',
      confidence: 'authoritative',
      updatedAtMs: 1_710_000_000_000,
    })
  })

  it('applies context.snapshot with null limitTokens (estimated, e.g. Claude)', () => {
    const ctx = makeContext({ engineKind: 'claude' })
    const effects: ConversationDomainEffect[] = [
      {
        type: 'apply_context_snapshot',
        payload: {
          usedTokens: 90000,
          limitTokens: null,
          remainingTokens: null,
          remainingPct: null,
          source: 'claude.assistant_usage',
          confidence: 'estimated',
        },
      },
    ]

    applyConversationDomainEffects({ effects, ctx })

    expect(ctx.session.applyContextSnapshot).toHaveBeenCalledWith({
      usedTokens: 90000,
      limitTokens: null,
      source: 'claude.assistant_usage',
      confidence: 'estimated',
      updatedAtMs: expect.any(Number),
    })
  })

  it('compact_boundary clears contextState', () => {
    const ctx = makeContext({ engineKind: 'claude' })
    const effects: ConversationDomainEffect[] = [
      {
        type: 'apply_system_compact_boundary',
        payload: {
          trigger: 'auto',
          preTokens: 150000,
        },
      },
    ]

    applyConversationDomainEffects({ effects, ctx })

    expect(ctx.session.clearContextState).toHaveBeenCalled()
    expect(ctx.session.addSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'compact_boundary',
        trigger: 'auto',
        preTokens: 150000,
        phase: 'compacting',
      })
    )
  })

  it('dispatches finalized streaming message on turn.result when stream was active', () => {
    const ctx = makeContext({ engineKind: 'codex' })
    ctx.stream.finalizeStreaming = vi.fn(() => 'assistant-1')

    applyConversationDomainEffects({
      effects: [makeTurnResultEffect({ outcome: 'success', result: 'done' })],
      ctx,
    })

    expect(ctx.session.finalizeStreamingMessage).toHaveBeenCalledWith('assistant-1')
    expect(ctx.dispatchMessageById).toHaveBeenCalledWith('assistant-1')
  })

  it('does not dispatch finalized message when there is no active stream on turn.result', () => {
    const ctx = makeContext({ engineKind: 'codex' })
    ctx.stream.finalizeStreaming = vi.fn(() => null)

    applyConversationDomainEffects({
      effects: [makeTurnResultEffect({ outcome: 'success' })],
      ctx,
    })

    expect(ctx.session.finalizeStreamingMessage).not.toHaveBeenCalled()
    expect(ctx.dispatchMessageById).not.toHaveBeenCalled()
  })

  it('dispatches finalized streaming message on protocol violation when stream was active', () => {
    const ctx = makeContext({ engineKind: 'codex' })
    ctx.stream.finalizeStreaming = vi.fn(() => 'assistant-violation-1')

    applyConversationDomainEffects({
      effects: [
        {
          type: 'apply_protocol_violation',
          payload: { reason: 'bad event order' },
        },
      ],
      ctx,
    })

    expect(ctx.session.finalizeStreamingMessage).toHaveBeenCalledWith('assistant-violation-1')
    expect(ctx.dispatchMessageById).toHaveBeenCalledWith('assistant-violation-1')
    expect(ctx.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'command:session:error',
      }),
    )
  })
})
