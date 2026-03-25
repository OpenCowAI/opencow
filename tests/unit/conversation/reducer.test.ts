// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { reduceConversationDomainEvent } from '../../../electron/conversation/domain/reducer'
import { createInitialConversationDomainState } from '../../../electron/conversation/domain/state'
import {
  isTurnScopedRuntimeEventKind,
  type EngineRuntimeEventEnvelope,
} from '../../../electron/conversation/runtime/events'

type EnvelopeOptions = {
  occurredAtMs?: number
  turnSeq?: number
  includeTurnRef?: boolean
}

function envelope(
  event: EngineRuntimeEventEnvelope['event'],
  options?: EnvelopeOptions,
): EngineRuntimeEventEnvelope {
  const shouldAttachTurnRef = options?.includeTurnRef ?? isTurnScopedRuntimeEventKind(event.kind)
  return {
    engine: 'claude',
    occurredAtMs: options?.occurredAtMs ?? 1_000,
    event,
    turnRef: shouldAttachTurnRef ? { turnSeq: options?.turnSeq ?? 1 } : undefined,
  }
}

describe('conversation domain reducer', () => {
  it('transitions to streaming on init', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'creating' }),
      eventEnvelope: envelope(
        {
          kind: 'session.initialized',
          payload: { sessionRef: 's1', model: 'm1' },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('streaming')
    expect(decision.effects.some((effect) => effect.type === 'apply_session_initialized')).toBe(true)
  })

  it('emits apply_assistant_partial without throttle decision', () => {
    const state = createInitialConversationDomainState({ phase: 'streaming' })

    const decision = reduceConversationDomainEvent({
      state,
      eventEnvelope: envelope(
        {
          kind: 'assistant.partial',
          payload: { blocks: [{ type: 'text', text: 'a' }] },
        },
        {
          occurredAtMs: 100,
          turnSeq: 1,
        },
      ),
    })

    const effect = decision.effects.find((e) => e.type === 'apply_assistant_partial')
    expect(effect).toBeTruthy()
    expect(effect!.payload).toEqual({ blocks: [{ type: 'text', text: 'a' }] })
    // Throttle decision is now handled by DispatchThrottle in the projection layer,
    // not by the domain reducer. The effect payload should not contain shouldDispatch.
    expect('shouldDispatch' in effect!.payload).toBe(false)
  })

  it('maps terminal error result to error phase', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: {
            outcome: 'execution_error',
            errors: ['boom'],
          },
        },
        { turnSeq: 1 },
      ),
    })

    expect(decision.state.phase).toBe('error')
    expect(decision.effects.some((effect) => effect.type === 'apply_turn_result')).toBe(true)
  })

  it('applies engine diagnostics without changing phase', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'engine.diagnostic',
          payload: {
            code: 'codex.long_thread_compaction_advisory',
            severity: 'warning',
            message: 'Heads up',
            terminal: false,
            source: 'codex.thread',
          },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('streaming')
    expect(decision.effects.some((effect) => effect.type === 'apply_engine_diagnostic')).toBe(true)
  })

  it('routes turn.usage to apply_turn_usage without changing phase', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.usage',
          payload: {
            inputTokens: 10,
            outputTokens: 2,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 1,
          },
        },
        { turnSeq: 1 },
      ),
    })

    expect(decision.state.phase).toBe('streaming')
    expect(decision.effects.some((effect) => effect.type === 'apply_turn_usage')).toBe(true)
  })

  it('routes context.snapshot to apply_context_snapshot without changing phase', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'context.snapshot',
          payload: {
            usedTokens: 1234,
            limitTokens: 272000,
            remainingTokens: 270766,
            remainingPct: 99.5,
            source: 'codex.token_count',
            confidence: 'authoritative',
          },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('streaming')
    expect(decision.effects.some((effect) => effect.type === 'apply_context_snapshot')).toBe(true)
  })

  it('fail-closes protocol violations', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'protocol.violation',
          payload: { reason: 'unknown type' },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('error')
    expect(decision.effects.some((effect) => effect.type === 'apply_protocol_violation')).toBe(true)
  })

  it('rejects non-turn-start events after terminal turn result', () => {
    const terminal = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: { outcome: 'success' },
        },
        { turnSeq: 1 },
      ),
    })

    const afterTerminal = reduceConversationDomainEvent({
      state: terminal.state,
      eventEnvelope: envelope(
        {
          kind: 'assistant.partial',
          payload: { blocks: [{ type: 'text', text: 'late partial' }] },
        },
        { turnSeq: 1 },
      ),
    })

    expect(afterTerminal.state.phase).toBe('error')
    const violation = afterTerminal.effects.find((effect) => effect.type === 'apply_protocol_violation')
    expect(violation).toBeTruthy()
    if (violation?.type === 'apply_protocol_violation') {
      expect(violation.payload.reason).toContain('Event received after terminal result')
    }
  })

  it('re-opens turn gate on turn.started', () => {
    const terminal = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: { outcome: 'success' },
        },
        { turnSeq: 1 },
      ),
    })

    const restarted = reduceConversationDomainEvent({
      state: terminal.state,
      eventEnvelope: envelope(
        {
          kind: 'turn.started',
          payload: {},
        },
        { turnSeq: 2 },
      ),
    })

    expect(restarted.state.phase).toBe('streaming')
    expect(restarted.state.turnClosed).toBe(false)

    const partial = reduceConversationDomainEvent({
      state: restarted.state,
      eventEnvelope: envelope(
        {
          kind: 'assistant.partial',
          payload: { blocks: [{ type: 'text', text: 'new turn' }] },
        },
        { turnSeq: 2 },
      ),
    })

    expect(partial.state.phase).toBe('streaming')
    expect(partial.effects.some((effect) => effect.type === 'apply_assistant_partial')).toBe(true)
  })

  it('allows diagnostics after terminal result without protocol violation', () => {
    const terminal = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: { outcome: 'success' },
        },
        { turnSeq: 1 },
      ),
    })

    const diagnostic = reduceConversationDomainEvent({
      state: terminal.state,
      eventEnvelope: envelope(
        {
          kind: 'engine.diagnostic',
          payload: {
            code: 'codex.event_stream_lag',
            severity: 'warning',
            message: 'lagged',
            terminal: false,
            source: 'codex.transport',
          },
        },
        { includeTurnRef: false },
      ),
    })

    expect(diagnostic.state.phase).toBe('idle')
    expect(diagnostic.effects.some((effect) => effect.type === 'apply_engine_diagnostic')).toBe(true)
    expect(diagnostic.effects.some((effect) => effect.type === 'apply_protocol_violation')).toBe(false)
  })

  it('does not recover streaming from awaiting_input on diagnostic-only events', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'awaiting_input' }),
      eventEnvelope: envelope(
        {
          kind: 'engine.diagnostic',
          payload: {
            code: 'codex.event_stream_lag',
            severity: 'warning',
            message: 'lagged',
            terminal: false,
            source: 'codex.transport',
          },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('awaiting_input')
    expect(decision.effects.some((effect) => effect.type === 'recover_streaming_from_awaiting_input')).toBe(false)
    expect(decision.effects.some((effect) => effect.type === 'apply_engine_diagnostic')).toBe(true)
  })

  it('does not recover streaming from awaiting_input on turn.usage events', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'awaiting_input' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.usage',
          payload: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
        { turnSeq: 1 },
      ),
    })

    expect(decision.state.phase).toBe('awaiting_input')
    expect(decision.effects.some((effect) => effect.type === 'recover_streaming_from_awaiting_input')).toBe(false)
    expect(decision.effects.some((effect) => effect.type === 'apply_turn_usage')).toBe(true)
  })

  it('does not recover streaming from awaiting_input on context.snapshot events', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'awaiting_input' }),
      eventEnvelope: envelope(
        {
          kind: 'context.snapshot',
          payload: {
            usedTokens: 500,
            limitTokens: 200000,
            remainingTokens: 199500,
            remainingPct: 99.75,
            source: 'codex.token_count',
            confidence: 'authoritative',
          },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('awaiting_input')
    expect(decision.effects.some((effect) => effect.type === 'recover_streaming_from_awaiting_input')).toBe(false)
    expect(decision.effects.some((effect) => effect.type === 'apply_context_snapshot')).toBe(true)
  })

  it('does not recover streaming from awaiting_input on system.task_notification events', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'awaiting_input' }),
      eventEnvelope: envelope(
        {
          kind: 'system.task_notification',
          payload: {
            taskId: 'task-456',
            status: 'completed',
            summary: 'Background task finished while awaiting input',
          },
        },
        { turnSeq: 1 },
      ),
    })

    expect(decision.state.phase).toBe('awaiting_input')
    expect(decision.effects.some((e) => e.type === 'recover_streaming_from_awaiting_input')).toBe(false)
    expect(decision.effects.some((e) => e.type === 'apply_system_task_notification')).toBe(true)
  })

  it('allows late turn.usage settlement for the just closed turn without reopening', () => {
    const terminal = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: { outcome: 'success' },
        },
        { turnSeq: 7 },
      ),
    })

    const lateUsage = reduceConversationDomainEvent({
      state: terminal.state,
      eventEnvelope: envelope(
        {
          kind: 'turn.usage',
          payload: {
            inputTokens: 42,
            outputTokens: 9,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
        { turnSeq: 7 },
      ),
    })

    expect(lateUsage.state.phase).toBe('idle')
    expect(lateUsage.state.turnClosed).toBe(true)
    expect(lateUsage.state.activeTurnSeq).toBeNull()
    expect(lateUsage.state.closedTurnSeq).toBe(7)
    expect(lateUsage.effects.some((effect) => effect.type === 'apply_turn_usage')).toBe(true)
    expect(lateUsage.effects.some((effect) => effect.type === 'apply_protocol_violation')).toBe(false)
  })

  it('allows context.snapshot after terminal result without protocol violation', () => {
    const terminal = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: { outcome: 'success' },
        },
        { turnSeq: 12 },
      ),
    })

    const snapshot = reduceConversationDomainEvent({
      state: terminal.state,
      eventEnvelope: envelope(
        {
          kind: 'context.snapshot',
          payload: {
            usedTokens: 2345,
            limitTokens: 272000,
            remainingTokens: 269655,
            remainingPct: 99.14,
            source: 'codex.token_count',
            confidence: 'authoritative',
          },
        },
        { includeTurnRef: false },
      ),
    })

    expect(snapshot.state.phase).toBe('idle')
    expect(snapshot.effects.some((effect) => effect.type === 'apply_context_snapshot')).toBe(true)
    expect(snapshot.effects.some((effect) => effect.type === 'apply_protocol_violation')).toBe(false)
  })

  it('allows system.task_notification after terminal result without protocol violation', () => {
    const terminal = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'turn.result',
          payload: { outcome: 'success' },
        },
        { turnSeq: 1 },
      ),
    })

    const taskNotification = reduceConversationDomainEvent({
      state: terminal.state,
      eventEnvelope: envelope(
        {
          kind: 'system.task_notification',
          payload: {
            taskId: 'task-123',
            status: 'completed',
            summary: 'Background task finished',
          },
        },
        { turnSeq: 1 },
      ),
    })

    expect(taskNotification.state.phase).toBe('idle')
    expect(taskNotification.effects.some((e) => e.type === 'apply_system_task_notification')).toBe(true)
    expect(taskNotification.effects.some((e) => e.type === 'apply_protocol_violation')).toBe(false)
  })

  it('fails closed when a turn-scoped event is missing turnRef', () => {
    const decision = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'assistant.partial',
          payload: { blocks: [{ type: 'text', text: 'missing ref' }] },
        },
        { includeTurnRef: false },
      ),
    })

    expect(decision.state.phase).toBe('error')
    const violation = decision.effects.find((effect) => effect.type === 'apply_protocol_violation')
    expect(violation).toBeTruthy()
    if (violation?.type === 'apply_protocol_violation') {
      expect(violation.payload.reason).toContain('missing turnRef.turnSeq')
    }
  })

  it('fails closed when turnRef does not match active turn', () => {
    const started = reduceConversationDomainEvent({
      state: createInitialConversationDomainState({ phase: 'streaming' }),
      eventEnvelope: envelope(
        {
          kind: 'assistant.partial',
          payload: { blocks: [{ type: 'text', text: 'start' }] },
        },
        { turnSeq: 1 },
      ),
    })

    const mismatch = reduceConversationDomainEvent({
      state: started.state,
      eventEnvelope: envelope(
        {
          kind: 'assistant.final',
          payload: { blocks: [{ type: 'text', text: 'different turn' }] },
        },
        { turnSeq: 2 },
      ),
    })

    expect(mismatch.state.phase).toBe('error')
    const violation = mismatch.effects.find((effect) => effect.type === 'apply_protocol_violation')
    expect(violation).toBeTruthy()
    if (violation?.type === 'apply_protocol_violation') {
      expect(violation.payload.reason).toContain('turnRef mismatch')
    }
  })
})
