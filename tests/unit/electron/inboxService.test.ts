// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InboxService } from '../../../electron/services/inboxService'
import type { EventSubscriptionPolicy } from '../../../electron/events/eventSubscriptionPolicy'
import type {
  EngineEventEnvelope, Session, AppStateMain, InboxMessage,
  HookEventMessage, SmartReminderMessage, InboxStats,
  DataBusEvent, InboxFilter, InboxMessageStatus, ManagedSessionInfo, IssueSummary
} from '../../../src/shared/types'

// === Helpers ===

function makeEngineEvent(overrides: Partial<EngineEventEnvelope> = {}): EngineEventEnvelope {
  const now = Date.now()
  return {
    eventId: 'hook:evt-1',
    sourceEventId: null,
    occurredAtMs: now,
    source: 'hook',
    timestamp: new Date(now).toISOString(),
    rawEventName: 'SessionStart',
    eventType: 'session_start',
    sessionRef: 'sess-1',
    payload: {},
    ...overrides
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'test-session',
    commandName: null,
    subtitle: null,
    status: 'active',
    cwd: '/tmp/test',
    gitBranch: null,
    lastActivity: Date.now(),
    startedAt: Date.now(),
    taskSummary: { total: 0, completed: 0, inProgress: 0, pending: 0 },
    ...overrides
  }
}

function makeHookEventMessage(overrides: Partial<HookEventMessage> = {}): HookEventMessage {
  return {
    id: 'msg-1',
    category: 'hook_event',
    eventType: 'session_start',
    status: 'unread',
    createdAt: Date.now(),
    projectId: 'proj-1',
    sessionId: 'sess-1',
    navigationTarget: {
      kind: 'session',
      projectId: 'proj-1',
      sessionId: 'sess-1',
    },
    rawPayload: {},
    ...overrides
  }
}

function makeManagedSession(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'sess-1',
    engineKind: 'claude',
    engineSessionRef: null,
    engineState: null,
    state: 'streaming',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: '/tmp/test',
    projectId: 'proj-1',
    model: 'claude-sonnet-4-6',
    messages: [],
    createdAt: Date.now(),
    lastActivity: Date.now(),
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

function makeAppState(overrides: Partial<AppStateMain> = {}): AppStateMain {
  return {
    projects: [],
    sessions: [],
    tasks: new Map(),
    stats: null,
    hookEvents: [],
    onboarding: { completed: false, hooksInstalled: false },
    inboxMessages: [],
    inboxUnreadCount: 0,
    settings: null,
    providerStatus: null,
    ...overrides
  }
}

// === Mock factories ===

function createMockStore() {
  return {
    load: vi.fn().mockResolvedValue([]),
    compact: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockImplementation(
      (id: string, status: InboxMessageStatus) =>
        Promise.resolve(makeHookEventMessage({ id, status }))
    ),
    dismiss: vi.fn().mockResolvedValue(true),
    markAllRead: vi.fn().mockResolvedValue(3),
    list: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ unreadCount: 0, total: 0 } as InboxStats)
  }
}

function createMockClassifier() {
  return {
    classifyEngineEvent: vi.fn().mockReturnValue(null),
    pruneDedup: vi.fn()
  }
}

function createMockDetector() {
  return {
    initializeFromMessages: vi.fn(),
    detectIdleSessions: vi.fn().mockReturnValue([]),
    onSessionActivity: vi.fn(),
    recordError: vi.fn(),
    checkErrorSpike: vi.fn().mockReturnValue(null),
    checkDailySummary: vi.fn().mockReturnValue(null)
  }
}

function allowAllPolicy(): EventSubscriptionPolicy {
  return {
    enabled: true,
    buckets: {
      complete: true,
      error: true,
      attention: true,
    },
  }
}

describe('InboxService', () => {
  let service: InboxService
  let mockStore: ReturnType<typeof createMockStore>
  let mockClassifier: ReturnType<typeof createMockClassifier>
  let mockDetector: ReturnType<typeof createMockDetector>
  let mockResolveManagedSession: ReturnType<typeof vi.fn>
  let mockResolveIssueBySessionRefs: ReturnType<typeof vi.fn>
  let mockResolveScheduleIdBySessionRefs: ReturnType<typeof vi.fn>
  let dispatched: DataBusEvent[]
  let appState: AppStateMain

  beforeEach(() => {
    vi.restoreAllMocks()
    dispatched = []
    appState = makeAppState({ sessions: [makeSession()] })
    mockStore = createMockStore()
    mockClassifier = createMockClassifier()
    mockDetector = createMockDetector()
    mockResolveManagedSession = vi.fn(async (sessionRefs: string[]) => (
      sessionRefs.includes('sess-1') ? makeManagedSession({ id: 'sess-1' }) : null
    ))
    mockResolveIssueBySessionRefs = vi.fn(async (_sessionIds: string[]) => null as IssueSummary | null)
    mockResolveScheduleIdBySessionRefs = vi.fn(async (_sessionIds: string[]) => null as string | null)

    service = new InboxService({
      dispatch: (event: DataBusEvent) => dispatched.push(event),
      getState: () => appState,
      store: mockStore as never,
      classifier: mockClassifier as never,
      detector: mockDetector as never,
      getEventSubscriptionPolicy: () => allowAllPolicy(),
      resolveManagedSession: mockResolveManagedSession,
      resolveIssueBySessionRefs: mockResolveIssueBySessionRefs,
      resolveScheduleIdBySessionRefs: mockResolveScheduleIdBySessionRefs,
    })
  })

  describe('start()', () => {
    it('calls store.load() and store.compact()', async () => {
      await service.start()

      expect(mockStore.load).toHaveBeenCalledOnce()
      expect(mockStore.compact).toHaveBeenCalledOnce()
      // load should be called before compact
      const loadOrder = mockStore.load.mock.invocationCallOrder[0]
      const compactOrder = mockStore.compact.mock.invocationCallOrder[0]
      expect(loadOrder).toBeLessThan(compactOrder)
    })

    it('initializes detector from loaded messages', async () => {
      const messages = [makeHookEventMessage({ id: 'msg-1' })]
      mockStore.load.mockResolvedValue(messages)

      await service.start()

      expect(mockDetector.initializeFromMessages).toHaveBeenCalledWith(messages)
    })

    it('dispatches inbox:updated after loading to sync DataBus', async () => {
      const messages = [makeHookEventMessage({ id: 'msg-1', status: 'unread' })]
      mockStore.load.mockResolvedValue(messages)
      mockStore.list.mockResolvedValue(messages)
      mockStore.getStats.mockResolvedValue({ unreadCount: 1, total: 1 })

      await service.start()

      const updatedEvents = dispatched.filter(e => e.type === 'inbox:updated')
      expect(updatedEvents).toHaveLength(1)
      expect(updatedEvents[0].payload).toEqual({
        messages,
        unreadCount: 1
      })
    })
  })

  describe('onEngineEvent()', () => {
    it('classifiable event -> store.add() -> dispatches inbox:updated only', async () => {
      const message = makeHookEventMessage()
      mockClassifier.classifyEngineEvent.mockReturnValue(message)

      const engineEvent = makeEngineEvent({ rawEventName: 'SessionStart', eventType: 'session_start' })
      await service.onEngineEvent(engineEvent)

      expect(mockClassifier.classifyEngineEvent).toHaveBeenCalledWith(
        engineEvent,
        {
          session: {
            canonicalId: 'sess-1',
            projectId: 'proj-1',
            navigationTarget: {
              kind: 'session',
              projectId: 'proj-1',
              sessionId: 'sess-1',
            },
          },
        },
      )
      expect(mockStore.add).toHaveBeenCalledWith(message)
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0].type).toBe('inbox:updated')
    })

    it('issue-linked event resolves issue navigation target', async () => {
      const message = makeHookEventMessage({
        navigationTarget: { kind: 'issue', projectId: 'proj-1', issueId: 'issue-1' },
      })
      mockClassifier.classifyEngineEvent.mockReturnValue(message)
      mockResolveManagedSession.mockResolvedValue(
        makeManagedSession({ origin: { source: 'issue', issueId: 'issue-1' } }),
      )

      const engineEvent = makeEngineEvent({ eventType: 'task_completed' })
      await service.onEngineEvent(engineEvent)

      expect(mockClassifier.classifyEngineEvent).toHaveBeenCalledWith(
        engineEvent,
        {
          session: {
            canonicalId: 'sess-1',
            projectId: 'proj-1',
            navigationTarget: { kind: 'issue', projectId: 'proj-1', issueId: 'issue-1' },
          },
        },
      )
    })

    it('schedule-linked event resolves schedule navigation target', async () => {
      const message = makeHookEventMessage({
        projectId: null,
        navigationTarget: { kind: 'schedule', scheduleId: 'sch-1' },
      })
      mockClassifier.classifyEngineEvent.mockReturnValue(message)
      mockResolveManagedSession.mockResolvedValue(null)
      mockResolveIssueBySessionRefs.mockResolvedValue(null)
      mockResolveScheduleIdBySessionRefs.mockResolvedValue('sch-1')

      const engineEvent = makeEngineEvent({ eventType: 'notification', sessionRef: 'engine-ref-1' })
      await service.onEngineEvent(engineEvent)

      expect(mockClassifier.classifyEngineEvent).toHaveBeenCalledWith(
        engineEvent,
        {
          session: {
            canonicalId: 'engine-ref-1',
            projectId: null,
            navigationTarget: { kind: 'schedule', scheduleId: 'sch-1' },
          },
        },
      )
    })

    it('managed chat session prefers session navigation over linked issue/schedule', async () => {
      const message = makeHookEventMessage({
        projectId: 'proj-chat',
        sessionId: 'managed-chat-1',
        navigationTarget: { kind: 'session', projectId: 'proj-chat', sessionId: 'managed-chat-1' },
      })
      mockClassifier.classifyEngineEvent.mockReturnValue(message)
      mockResolveManagedSession.mockResolvedValue(
        makeManagedSession({
          id: 'managed-chat-1',
          projectId: 'proj-chat',
          origin: { source: 'agent' },
          engineSessionRef: 'engine-ref-1',
        }),
      )
      mockResolveIssueBySessionRefs.mockResolvedValue({
        id: 'issue-1',
        title: 'Linked issue',
        status: 'todo',
        priority: 'medium',
        labels: [],
        projectId: 'proj-linked',
        sessionId: null,
        parentIssueId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        readAt: null,
        lastAgentActivityAt: null,
      })
      mockResolveScheduleIdBySessionRefs.mockResolvedValue('sch-1')

      const engineEvent = makeEngineEvent({ eventType: 'task_completed', sessionRef: 'engine-ref-1' })
      await service.onEngineEvent(engineEvent)

      expect(mockClassifier.classifyEngineEvent).toHaveBeenCalledWith(
        engineEvent,
        {
          session: {
            canonicalId: 'managed-chat-1',
            projectId: 'proj-chat',
            navigationTarget: { kind: 'session', projectId: 'proj-chat', sessionId: 'managed-chat-1' },
          },
        },
      )
    })

    it('unclassifiable engine event -> no store.add(), no dispatch', async () => {
      mockClassifier.classifyEngineEvent.mockReturnValue(null)

      const engineEvent = makeEngineEvent({ rawEventName: 'TaskCompleted', eventType: 'task_completed' })
      await service.onEngineEvent(engineEvent)

      expect(mockStore.add).not.toHaveBeenCalled()
      expect(dispatched).toHaveLength(0)
    })

    it('PostToolUseFailure -> also calls detector.recordError() and detector.checkErrorSpike()', async () => {
      const message = makeHookEventMessage({ eventType: 'session_error' })
      mockClassifier.classifyEngineEvent.mockReturnValue(message)
      mockDetector.checkErrorSpike.mockReturnValue(null)

      const engineEvent = makeEngineEvent({
        rawEventName: 'PostToolUseFailure',
        eventType: 'session_error',
        sessionRef: 'sess-1'
      })
      await service.onEngineEvent(engineEvent)

      expect(mockResolveManagedSession).toHaveBeenCalledWith(['sess-1'])
      expect(mockDetector.recordError).toHaveBeenCalledWith('proj-1')
      expect(mockDetector.checkErrorSpike).toHaveBeenCalledWith('proj-1')
    })

    it('PostToolUseFailure with error spike -> adds spike message to store and dispatches', async () => {
      const classifiedMessage = makeHookEventMessage({ eventType: 'session_error' })
      mockClassifier.classifyEngineEvent.mockReturnValue(classifiedMessage)

      const spikeMessage: SmartReminderMessage = {
        id: 'spike-1',
        category: 'smart_reminder',
        reminderType: 'error_spike',
        status: 'unread',
        createdAt: Date.now(),
        context: { projectId: 'proj-1', errorCount: 3, windowMs: 600000 }
      }
      mockDetector.checkErrorSpike.mockReturnValue(spikeMessage)

      const engineEvent = makeEngineEvent({
        rawEventName: 'PostToolUseFailure',
        eventType: 'session_error',
        sessionRef: 'sess-1'
      })
      await service.onEngineEvent(engineEvent)

      // store.add called twice: once for classified message, once for spike
      expect(mockStore.add).toHaveBeenCalledTimes(2)
      expect(mockStore.add).toHaveBeenCalledWith(classifiedMessage)
      expect(mockStore.add).toHaveBeenCalledWith(spikeMessage)

      // dispatched: updated (classified), updated (spike)
      const updatedEvents = dispatched.filter(e => e.type === 'inbox:updated')
      expect(updatedEvents).toHaveLength(2)
      expect(dispatched.filter(e => e.type === 'inbox:new-message')).toHaveLength(0)
    })

    it('calls detector.onSessionActivity() when session found', async () => {
      mockClassifier.classifyEngineEvent.mockReturnValue(null)

      const engineEvent = makeEngineEvent({ sessionRef: 'sess-1', rawEventName: 'TaskCompleted', eventType: 'task_completed' })
      await service.onEngineEvent(engineEvent)

      expect(mockDetector.onSessionActivity).toHaveBeenCalledWith('sess-1')
    })

    it('uses managed-session canonical id for detector activity when hook session id is engine ref', async () => {
      mockClassifier.classifyEngineEvent.mockReturnValue(null)
      mockResolveManagedSession.mockResolvedValue(
        makeManagedSession({
          id: 'managed-chat-1',
          projectId: 'proj-1',
          origin: { source: 'agent' },
          engineSessionRef: 'engine-ref-1',
        }),
      )

      const engineEvent = makeEngineEvent({
        sessionRef: 'engine-ref-1',
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
      })
      await service.onEngineEvent(engineEvent)

      expect(mockDetector.onSessionActivity).toHaveBeenCalledWith('managed-chat-1')
    })

    it('does NOT call detector.onSessionActivity() when session not found', async () => {
      mockClassifier.classifyEngineEvent.mockReturnValue(null)

      const engineEvent = makeEngineEvent({
        sessionRef: 'unknown-sess',
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
      })
      await service.onEngineEvent(engineEvent)

      expect(mockDetector.onSessionActivity).not.toHaveBeenCalled()
    })

    it('PostToolUseFailure without matching session does not call recordError/checkErrorSpike', async () => {
      mockClassifier.classifyEngineEvent.mockReturnValue(null)

      const engineEvent = makeEngineEvent({
        rawEventName: 'PostToolUseFailure',
        eventType: 'session_error',
        sessionRef: 'unknown-sess'
      })
      await service.onEngineEvent(engineEvent)

      expect(mockDetector.recordError).not.toHaveBeenCalled()
      expect(mockDetector.checkErrorSpike).not.toHaveBeenCalled()
    })

    it('blocks inbox message creation when event subscription policy rejects event', async () => {
      service = new InboxService({
        dispatch: (event: DataBusEvent) => dispatched.push(event),
        getState: () => appState,
        store: mockStore as never,
        classifier: mockClassifier as never,
        detector: mockDetector as never,
        getEventSubscriptionPolicy: () => ({
          enabled: true,
          buckets: {
            complete: false,
            error: false,
            attention: false,
          },
        }),
        resolveManagedSession: mockResolveManagedSession,
        resolveIssueBySessionRefs: mockResolveIssueBySessionRefs,
        resolveScheduleIdBySessionRefs: mockResolveScheduleIdBySessionRefs,
      })
      mockClassifier.classifyEngineEvent.mockReturnValue(makeHookEventMessage())

      const engineEvent = makeEngineEvent({
        rawEventName: 'TaskCompleted',
        eventType: 'task_completed',
        sessionRef: 'sess-1',
      })
      await service.onEngineEvent(engineEvent)

      expect(mockClassifier.classifyEngineEvent).not.toHaveBeenCalled()
      expect(mockStore.add).not.toHaveBeenCalled()
      expect(mockDetector.onSessionActivity).toHaveBeenCalledWith('sess-1')
      expect(dispatched).toHaveLength(0)
    })
  })

  describe('stop()', () => {
    it('clears the idle scan timer', async () => {
      const clearSpy = vi.spyOn(global, 'clearInterval')

      await service.start()
      service.stop()

      expect(clearSpy).toHaveBeenCalled()
      clearSpy.mockRestore()
    })

    it('is safe to call stop() without start()', () => {
      // Should not throw
      expect(() => service.stop()).not.toThrow()
    })
  })

  describe('listMessages()', () => {
    it('delegates to store.list() without filter', async () => {
      const messages = [makeHookEventMessage()]
      mockStore.list.mockResolvedValue(messages)

      const result = await service.listMessages()

      expect(mockStore.list).toHaveBeenCalledWith(undefined)
      expect(result).toEqual(messages)
    })

    it('delegates to store.list() with filter', async () => {
      const filter: InboxFilter = { category: 'hook_event', status: 'unread' }
      mockStore.list.mockResolvedValue([])

      await service.listMessages(filter)

      expect(mockStore.list).toHaveBeenCalledWith(filter)
    })
  })

  describe('updateMessage()', () => {
    it('delegates to store.update() and dispatches update', async () => {
      const updated = makeHookEventMessage({ id: 'msg-1', status: 'read' })
      mockStore.update.mockResolvedValue(updated)

      const result = await service.updateMessage({ id: 'msg-1', status: 'read' })

      expect(mockStore.update).toHaveBeenCalledWith('msg-1', 'read')
      expect(result).toEqual(updated)

      const updateEvents = dispatched.filter(e => e.type === 'inbox:updated')
      expect(updateEvents).toHaveLength(1)
    })
  })

  describe('dismissMessage()', () => {
    it('delegates to store.dismiss() and dispatches update on success', async () => {
      mockStore.dismiss.mockResolvedValue(true)

      const result = await service.dismissMessage('msg-1')

      expect(mockStore.dismiss).toHaveBeenCalledWith('msg-1')
      expect(result).toBe(true)

      const updateEvents = dispatched.filter(e => e.type === 'inbox:updated')
      expect(updateEvents).toHaveLength(1)
    })

    it('does not dispatch update when dismiss returns false', async () => {
      mockStore.dismiss.mockResolvedValue(false)

      const result = await service.dismissMessage('not-found')

      expect(result).toBe(false)
      expect(dispatched).toHaveLength(0)
    })
  })

  describe('markAllRead()', () => {
    it('delegates to store.markAllRead() and dispatches update when count > 0', async () => {
      mockStore.markAllRead.mockResolvedValue(3)

      const result = await service.markAllRead()

      expect(mockStore.markAllRead).toHaveBeenCalledOnce()
      expect(result).toBe(3)

      const updateEvents = dispatched.filter(e => e.type === 'inbox:updated')
      expect(updateEvents).toHaveLength(1)
    })

    it('does not dispatch update when count is 0', async () => {
      mockStore.markAllRead.mockResolvedValue(0)

      const result = await service.markAllRead()

      expect(result).toBe(0)
      expect(dispatched).toHaveLength(0)
    })
  })

  describe('getStats()', () => {
    it('delegates to store.getStats()', async () => {
      const stats: InboxStats = { unreadCount: 5, total: 10 }
      mockStore.getStats.mockResolvedValue(stats)

      const result = await service.getStats()

      expect(mockStore.getStats).toHaveBeenCalledOnce()
      expect(result).toEqual(stats)
    })
  })
})
