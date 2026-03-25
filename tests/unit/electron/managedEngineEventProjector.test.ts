// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { DataBusEvent, ManagedSessionInfo } from '@shared/types'
import { ManagedEngineEventProjector } from '../../../electron/events/managedEngineEventProjector'

function makeManagedInfo(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'managed-1',
    engineKind: 'codex',
    engineSessionRef: null,

    engineState: null,
    state: 'creating',
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
    ...overrides,
  }
}

describe('ManagedEngineEventProjector', () => {
  it('emits session_start when created session enters active', () => {
    const projector = new ManagedEngineEventProjector()
    const events = projector.project({
      type: 'command:session:created',
      payload: makeManagedInfo({ state: 'creating' }),
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(
      expect.objectContaining({
        source: 'managed_runtime',
        rawEventName: 'SessionStart',
        eventType: 'session_start',
        sessionRef: 'managed-1',
      }),
    )
  })

  it('does not emit duplicated session_start while already active', () => {
    const projector = new ManagedEngineEventProjector()
    projector.project({
      type: 'command:session:created',
      payload: makeManagedInfo({ state: 'creating' }),
    })

    const events = projector.project({
      type: 'command:session:updated',
      payload: makeManagedInfo({ state: 'streaming' }),
    })

    expect(events).toHaveLength(0)
  })

  it('emits session_start when updated from waiting to active', () => {
    const projector = new ManagedEngineEventProjector()
    projector.project({
      type: 'command:session:created',
      payload: makeManagedInfo({ state: 'awaiting_input' }),
    })

    const events = projector.project({
      type: 'command:session:updated',
      payload: makeManagedInfo({ state: 'streaming' }),
    })

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('session_start')
  })

  it('emits stop/error events from managed command events', () => {
    const projector = new ManagedEngineEventProjector()
    const idleEvents = projector.project({
      type: 'command:session:idle',
      payload: {
        sessionId: 'managed-1',
        origin: { source: 'agent' },
        stopReason: 'completed',
      },
    } satisfies Extract<DataBusEvent, { type: 'command:session:idle' }>)
    const errorEvents = projector.project({
      type: 'command:session:error',
      payload: {
        sessionId: 'managed-1',
        origin: { source: 'agent' },
        error: 'boom',
      },
    } satisfies Extract<DataBusEvent, { type: 'command:session:error' }>)

    expect(idleEvents).toHaveLength(1)
    expect(idleEvents[0].eventType).toBe('session_stop')
    expect(errorEvents).toHaveLength(1)
    expect(errorEvents[0].eventType).toBe('session_error')
  })

  it('suppresses duplicate stop when stopped arrives after idle', () => {
    const projector = new ManagedEngineEventProjector()
    projector.project({
      type: 'command:session:idle',
      payload: {
        sessionId: 'managed-1',
        origin: { source: 'agent' },
        stopReason: 'completed',
      },
    } satisfies Extract<DataBusEvent, { type: 'command:session:idle' }>)

    const stoppedEvents = projector.project({
      type: 'command:session:stopped',
      payload: {
        sessionId: 'managed-1',
        origin: { source: 'agent' },
        stopReason: 'user_stopped',
      },
    } satisfies Extract<DataBusEvent, { type: 'command:session:stopped' }>)

    expect(stoppedEvents).toHaveLength(0)
  })

  it('prunes stale managed status cache entries', () => {
    let now = 10_000
    const projector = new ManagedEngineEventProjector({
      now: () => now,
      staleMs: 100,
      maxEntries: 100,
    })

    projector.project({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: 'managed-old', state: 'creating' }),
    })

    now = 10_200

    const events = projector.project({
      type: 'command:session:stopped',
      payload: {
        sessionId: 'managed-old',
        origin: { source: 'agent' },
        stopReason: 'user_stopped',
      },
    } satisfies Extract<DataBusEvent, { type: 'command:session:stopped' }>)

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('session_stop')
  })

  it('prunes oldest entries when exceeding max cache size', () => {
    let now = 1_000
    const projector = new ManagedEngineEventProjector({
      now: () => now,
      maxEntries: 1,
      staleMs: 10_000,
    })

    projector.project({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: 'managed-a', state: 'creating' }),
    })

    now = 1_100
    projector.project({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: 'managed-b', state: 'creating' }),
    })

    const events = projector.project({
      type: 'command:session:stopped',
      payload: {
        sessionId: 'managed-a',
        origin: { source: 'agent' },
        stopReason: 'user_stopped',
      },
    } satisfies Extract<DataBusEvent, { type: 'command:session:stopped' }>)

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('session_stop')
  })
})
