// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { applyConversationDomainEffects } from '../../../electron/conversation/projection/effectProjector'
import type { ConversationDomainEffect } from '../../../electron/conversation/domain/effects'
import type { SessionContext } from '../../../electron/command/sessionContext'

function makeContext(params: { engineKind: 'claude' | 'codex' }) {
  const session = {
    recordTurnUsage: vi.fn(),
    getEngineKind: vi.fn(() => params.engineKind),
    applyContextSnapshot: vi.fn(() => true),
    clearContextState: vi.fn(),
    addSystemEvent: vi.fn(() => 'sys-1'),
    setActivity: vi.fn(),
    updateSystemEventById: vi.fn(),
  }

  return {
    session,
    dispatchSessionUpdated: vi.fn(),
    dispatchLastMessage: vi.fn(),
    dispatchMessageById: vi.fn(),
    timers: { cancel: vi.fn(), set: vi.fn() },
    throttle: { scheduleSession: vi.fn(), scheduleMessage: vi.fn(), flushNow: vi.fn() },
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
})
