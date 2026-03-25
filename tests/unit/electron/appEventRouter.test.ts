// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEvent, ManagedSessionInfo, Project, Session, StatusTransition } from '@shared/types'
import { DataBus } from '../../../electron/core/dataBus'
import { wireEventRoutes } from '../../../electron/app/appEventRouter'

vi.mock('electron', () => ({
  nativeTheme: { themeSource: 'system' },
}))

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => resolve()))
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    path: '/tmp/proj-1',
    name: 'Project 1',
    sessionCount: 0,
    pinOrder: null,
    archivedAt: null,
    displayOrder: 0,
    updatedAt: Date.now(),
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Session 1',
    commandName: null,
    subtitle: null,
    status: 'active',
    cwd: '/tmp/proj-1',
    gitBranch: 'main',
    lastActivity: Date.now(),
    startedAt: Date.now(),
    taskSummary: { total: 0, completed: 0, inProgress: 0, pending: 0 },
    ...overrides,
  }
}

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

function makeManagedInfo(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'ccb-1',
    engineKind: 'claude',
    engineSessionRef: null,

    engineState: null,
    state: 'creating',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: null,
    projectId: null,
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
    activeDurationMs: 0,
    activeStartedAt: Date.now(),
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

describe('AppEventRouter managed transition routing', () => {
  let bus: DataBus

  const notificationOnTransition = vi.fn()
  const webhookOnTransition = vi.fn(async () => undefined)
  const webhookOnEngineEvent = vi.fn(async () => undefined)
  const inboxOnEngineEvent = vi.fn(async () => undefined)
  const orchestratorGetSession = vi.fn(async () => null)

  beforeEach(() => {
    bus = new DataBus()
    notificationOnTransition.mockReset()
    webhookOnTransition.mockReset()
    webhookOnTransition.mockImplementation(async () => undefined)
    webhookOnEngineEvent.mockReset()
    webhookOnEngineEvent.mockImplementation(async () => undefined)
    inboxOnEngineEvent.mockReset()
    inboxOnEngineEvent.mockImplementation(async () => undefined)
    orchestratorGetSession.mockReset()
    orchestratorGetSession.mockImplementation(async () => null)

    wireEventRoutes({
      bus,
      notificationService: { onTransition: notificationOnTransition } as never,
      webhookService: {
        onTransition: webhookOnTransition,
        onEngineEvent: webhookOnEngineEvent,
      } as never,
      inboxService: { onEngineEvent: inboxOnEngineEvent } as never,
      orchestrator: { getSession: orchestratorGetSession } as never,
      artifactService: {
        captureFromManagedSession: vi.fn(async () => undefined),
        captureFromMonitorSession: vi.fn(async () => undefined),
      } as never,
      imBridgeManager: {
        syncWithSettings: vi.fn(async () => undefined),
        releaseActivePlaceholder: vi.fn(),
        handleAssistantMessage: vi.fn(async () => undefined),
        handleEvoseProgress: vi.fn(async () => undefined),
      } as never,
      proxyFetchFactory: { getStandardFetch: vi.fn(() => globalThis.fetch) } as never,
      eventListener: null,
      gitService: null,
    })
  })

  it('derives managed session transitions from command:session:* events', async () => {
    const sessionId = 'ccb-managed-1'

    bus.dispatch({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: sessionId, state: 'creating' }),
    })
    bus.dispatch({
      type: 'command:session:updated',
      payload: makeManagedInfo({ id: sessionId, state: 'awaiting_input' }),
    })
    bus.dispatch({
      type: 'command:session:updated',
      payload: makeManagedInfo({ id: sessionId, state: 'idle' }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(notificationOnTransition).toHaveBeenCalledTimes(2)
    expect(webhookOnTransition).toHaveBeenCalledTimes(2)

    const waitingTransition = notificationOnTransition.mock.calls[0][0] as StatusTransition
    expect(waitingTransition.sessionId).toBe(sessionId)
    expect(waitingTransition.previousStatus).toBe('active')
    expect(waitingTransition.newStatus).toBe('waiting')

    const completedTransition = notificationOnTransition.mock.calls[1][0] as StatusTransition
    expect(completedTransition.sessionId).toBe(sessionId)
    expect(completedTransition.previousStatus).toBe('waiting')
    expect(completedTransition.newStatus).toBe('completed')
  })

  it('skips hook-derived status transitions for managed sessions to avoid duplicates', async () => {
    const sessionId = 'ccb-managed-dup'

    bus.dispatch({
      type: 'command:session:created',
      payload: makeManagedInfo({ id: sessionId, state: 'creating' }),
    })

    await flushMicrotasks()
    notificationOnTransition.mockClear()
    webhookOnTransition.mockClear()

    bus.dispatch({
      type: 'sessions:updated',
      payload: {
        projects: [makeProject()],
        sessions: [makeSession({ id: sessionId, name: 'Managed Mirror', status: 'active' })],
      },
    })
    bus.dispatch({
      type: 'hooks:event',
      payload: makeHookEvent({
        sessionId,
        rawEventName: 'Stop',
        eventType: 'session_stop',
      }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(notificationOnTransition).not.toHaveBeenCalled()
    expect(webhookOnTransition).not.toHaveBeenCalled()
  })

  it('keeps hook-derived status transitions for non-managed sessions', async () => {
    const sessionId = 'sess-monitor-1'

    bus.dispatch({
      type: 'sessions:updated',
      payload: {
        projects: [makeProject()],
        sessions: [makeSession({ id: sessionId, name: 'Monitor Session', status: 'active' })],
      },
    })
    bus.dispatch({
      type: 'hooks:event',
      payload: makeHookEvent({
        sessionId,
        rawEventName: 'Stop',
        eventType: 'session_stop',
      }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(notificationOnTransition).toHaveBeenCalledTimes(1)
    expect(webhookOnTransition).toHaveBeenCalledTimes(1)

    const transition = notificationOnTransition.mock.calls[0][0] as StatusTransition
    expect(transition.sessionId).toBe(sessionId)
    expect(transition.sessionName).toBe('Monitor Session')
    expect(transition.previousStatus).toBe('active')
    expect(transition.newStatus).toBe('completed')
  })

  it('forwards signal hook events to inbox via normalized engine event', async () => {
    bus.dispatch({
      type: 'hooks:event',
      payload: makeHookEvent({
        sessionId: 'engine-ref-10',
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
      }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(inboxOnEngineEvent).toHaveBeenCalledTimes(1)
    expect(inboxOnEngineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'hook',
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
        sessionRef: 'engine-ref-10',
      }),
    )
    expect(webhookOnEngineEvent).toHaveBeenCalledTimes(1)
    expect(webhookOnEngineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'hook',
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
        sessionRef: 'engine-ref-10',
      }),
    )
  })

  it('projects command created(active) into managed session_start engine event', async () => {
    const sessionId = 'ccb-start-1'

    bus.dispatch({
      type: 'command:session:created',
      payload: makeManagedInfo({
        id: sessionId,
        state: 'creating',
        model: 'o3',
      }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(inboxOnEngineEvent).toHaveBeenCalledTimes(1)
    expect(inboxOnEngineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'managed_runtime',
        rawEventName: 'SessionStart',
        eventType: 'session_start',
        sessionRef: sessionId,
      }),
    )
    expect(webhookOnEngineEvent).toHaveBeenCalledTimes(1)
  })

  it('projects command updated(waiting→active) into managed session_start engine event', async () => {
    const sessionId = 'ccb-start-2'
    bus.dispatch({
      type: 'command:session:created',
      payload: makeManagedInfo({
        id: sessionId,
        state: 'awaiting_input',
      }),
    })
    await flushMicrotasks()
    await flushMicrotasks()
    inboxOnEngineEvent.mockClear()
    webhookOnEngineEvent.mockClear()

    bus.dispatch({
      type: 'command:session:updated',
      payload: makeManagedInfo({
        id: sessionId,
        state: 'streaming',
      }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(inboxOnEngineEvent).toHaveBeenCalledTimes(1)
    expect(inboxOnEngineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'managed_runtime',
        rawEventName: 'SessionStart',
        eventType: 'session_start',
        sessionRef: sessionId,
      }),
    )
    expect(webhookOnEngineEvent).toHaveBeenCalledTimes(1)
  })

  it('does not forward non-signal hook events to inbox', async () => {
    bus.dispatch({
      type: 'hooks:event',
      payload: makeHookEvent({
        sessionId: 'engine-ref-11',
        rawEventName: 'PreToolUse',
        eventType: null,
      }),
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(inboxOnEngineEvent).not.toHaveBeenCalled()
    expect(webhookOnEngineEvent).not.toHaveBeenCalled()
  })

  it('projects command idle into normalized inbox engine event', async () => {
    const sessionId = 'ccb-codex-1'

    bus.dispatch({
      type: 'command:session:idle',
      payload: {
        sessionId,
        origin: { source: 'agent' },
        stopReason: 'completed',
      },
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(inboxOnEngineEvent).toHaveBeenCalledTimes(1)
    expect(inboxOnEngineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'managed_runtime',
        rawEventName: 'Stop',
        eventType: 'session_stop',
        sessionRef: sessionId,
      }),
    )
  })

  it('projects command error into normalized inbox engine event', async () => {
    const sessionId = 'ccb-codex-2'

    bus.dispatch({
      type: 'command:session:error',
      payload: {
        sessionId,
        origin: { source: 'agent' },
        error: 'boom',
      },
    })

    await flushMicrotasks()
    await flushMicrotasks()

    expect(inboxOnEngineEvent).toHaveBeenCalledTimes(1)
    expect(inboxOnEngineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'managed_runtime',
        rawEventName: 'PostToolUseFailure',
        eventType: 'session_error',
        sessionRef: sessionId,
      }),
    )
  })
})
