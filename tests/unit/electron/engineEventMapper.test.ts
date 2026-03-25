// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { DataBusEvent, HookEvent } from '@shared/types'
import {
  mapCommandSessionErrorToEngineEvent,
  mapCommandSessionIdleToEngineEvent,
  mapCommandSessionStoppedToEngineEvent,
  mapManagedSessionInfoToSessionStartEngineEvent,
  mapHookEventToEngineEvent,
} from '../../../electron/events/engineEventMapper'

function makeHookEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    timestamp: new Date().toISOString(),
    rawEventName: 'SessionStart',
    eventType: 'session_start',
    sessionId: 'sess-1',
    payload: {},
    ...overrides,
  }
}

describe('engineEventMapper', () => {
  it('maps HookEvent with signal type into EngineEvent', () => {
    const hookEvent = makeHookEvent({
      timestamp: '2026-03-20T16:48:11.901Z',
      rawEventName: 'Stop',
      eventType: 'session_stop',
      sessionId: 'engine-ref-1',
      payload: { stopReason: 'completed' },
    })

    expect(mapHookEventToEngineEvent(hookEvent)).toEqual(
      expect.objectContaining({
        source: 'hook',
        timestamp: hookEvent.timestamp,
        rawEventName: 'Stop',
        eventType: 'session_stop',
        sessionRef: 'engine-ref-1',
        payload: { stopReason: 'completed' },
        sourceEventId: null,
        occurredAtMs: Date.parse('2026-03-20T16:48:11.901Z'),
        eventId: expect.stringMatching(/^hook:/),
      }),
    )
  })

  it('returns null for non-signal HookEvent', () => {
    const hookEvent = makeHookEvent({ rawEventName: 'PreToolUse', eventType: null })
    expect(mapHookEventToEngineEvent(hookEvent)).toBeNull()
  })

  it('maps command:session:idle into managed_runtime EngineEvent', () => {
    const event: Extract<DataBusEvent, { type: 'command:session:idle' }> = {
      type: 'command:session:idle',
      payload: {
        sessionId: 'ccb-1',
        origin: { source: 'agent' },
        stopReason: 'completed',
        result: 'done',
        costUsd: 0.12,
      },
    }

    const mapped = mapCommandSessionIdleToEngineEvent(event)
    expect(mapped.source).toBe('managed_runtime')
    expect(mapped.rawEventName).toBe('Stop')
    expect(mapped.eventType).toBe('session_stop')
    expect(mapped.sessionRef).toBe('ccb-1')
    expect(mapped.payload).toEqual({
      origin: { source: 'agent' },
      stopReason: 'completed',
      result: 'done',
      costUsd: 0.12,
    })
  })

  it('maps command:session:error into managed_runtime EngineEvent', () => {
    const event: Extract<DataBusEvent, { type: 'command:session:error' }> = {
      type: 'command:session:error',
      payload: {
        sessionId: 'ccb-2',
        origin: { source: 'agent' },
        error: 'boom',
      },
    }

    const mapped = mapCommandSessionErrorToEngineEvent(event)
    expect(mapped.source).toBe('managed_runtime')
    expect(mapped.rawEventName).toBe('PostToolUseFailure')
    expect(mapped.eventType).toBe('session_error')
    expect(mapped.sessionRef).toBe('ccb-2')
    expect(mapped.payload).toEqual({
      origin: { source: 'agent' },
      error: 'boom',
    })
  })

  it('maps command:session:stopped into managed_runtime session_stop EngineEvent', () => {
    const event: Extract<DataBusEvent, { type: 'command:session:stopped' }> = {
      type: 'command:session:stopped',
      payload: {
        sessionId: 'ccb-3',
        origin: { source: 'agent' },
        stopReason: 'user_stopped',
        result: 'done',
        costUsd: 0.5,
      },
    }
    const mapped = mapCommandSessionStoppedToEngineEvent(event)
    expect(mapped.source).toBe('managed_runtime')
    expect(mapped.rawEventName).toBe('Stop')
    expect(mapped.eventType).toBe('session_stop')
    expect(mapped.sessionRef).toBe('ccb-3')
    expect(mapped.payload).toEqual({
      origin: { source: 'agent' },
      stopReason: 'user_stopped',
      result: 'done',
      costUsd: 0.5,
    })
  })

  it('maps ManagedSessionInfo into managed_runtime session_start EngineEvent', () => {
    const mapped = mapManagedSessionInfoToSessionStartEngineEvent({
      id: 'managed-1',
      engineKind: 'codex',
      engineSessionRef: null,

      engineState: null,
      state: 'streaming',
      stopReason: null,
      origin: { source: 'agent' },
      projectPath: '/tmp/proj',
      projectId: 'proj-1',
      model: 'o3',
      messages: [],
      createdAt: 1,
      lastActivity: 1,
      activeDurationMs: 0,
      activeStartedAt: null,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastInputTokens: 0,
      activity: null,
      error: null,
      executionContext: null,
    })

    expect(mapped.source).toBe('managed_runtime')
    expect(mapped.rawEventName).toBe('SessionStart')
    expect(mapped.eventType).toBe('session_start')
    expect(mapped.sessionRef).toBe('managed-1')
    expect(mapped.payload).toEqual(
      expect.objectContaining({
        model: 'o3',
        engineKind: 'codex',
        state: 'streaming',
        projectId: 'proj-1',
      }),
    )
  })

  it('generates different eventId for repeated managed idle events', () => {
    const event: Extract<DataBusEvent, { type: 'command:session:idle' }> = {
      type: 'command:session:idle',
      payload: {
        sessionId: 'ccb-repeat',
        origin: { source: 'agent' },
        stopReason: 'completed',
      },
    }
    const first = mapCommandSessionIdleToEngineEvent(event)
    const second = mapCommandSessionIdleToEngineEvent(event)
    expect(first.eventId).not.toBe(second.eventId)
  })
})
