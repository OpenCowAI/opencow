// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataBus } from '../../../electron/core/dataBus'
import type {
  Project,
  Session,
  HookEvent,
  StatsSnapshot,
  TaskFull,
  DataBusEvent,
  AppStateMain,
  OnboardingState,
  SessionContent,
  StatusTransition
} from '@shared/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    path: '/home/user/project',
    name: 'My Project',
    sessionCount: 1,
    pinOrder: null,
    archivedAt: null,
    ...overrides
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Session 1',
    subtitle: null,
    status: 'active',
    cwd: '/home/user/project',
    gitBranch: 'main',
    lastActivity: Date.now(),
    startedAt: Date.now(),
    taskSummary: { total: 0, completed: 0, inProgress: 0, pending: 0 },
    ...overrides
  }
}

function makeHookEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    timestamp: new Date().toISOString(),
    rawEventName: 'SessionStart',
    eventType: 'session_start',
    sessionId: 'sess-1',
    payload: {},
    ...overrides
  }
}

function makeStats(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    todayCostUSD: 0.5,
    todayTokens: 10000,
    todaySessions: 3,
    todayToolCalls: 25,
    totalSessions: 100,
    totalMessages: 500,
    ...overrides
  }
}

function makeTaskFull(overrides: Partial<TaskFull> = {}): TaskFull {
  return {
    id: 'task-1',
    subject: 'Fix bug',
    description: 'Fix the critical bug',
    activeForm: 'Fixing bug',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides
  }
}

describe('DataBus', () => {
  let bus: DataBus

  beforeEach(() => {
    bus = new DataBus()
  })

  describe('initial state', () => {
    it('should have empty initial state', () => {
      const state = bus.getState()
      expect(state.projects).toEqual([])
      expect(state.sessions).toEqual([])
      expect(state.tasks).toEqual(new Map())
      expect(state.stats).toBeNull()
      expect(state.hookEvents).toEqual([])
      expect(state.onboarding).toEqual({ completed: false, hooksInstalled: false })
    })
  })

  describe('sessions:updated dispatch', () => {
    it('should update projects and sessions', () => {
      const projects = [makeProject()]
      const sessions = [makeSession()]

      bus.dispatch({
        type: 'sessions:updated',
        payload: { projects, sessions }
      })

      const state = bus.getState()
      expect(state.projects).toEqual(projects)
      expect(state.sessions).toEqual(sessions)
    })

    it('should replace previous sessions data on subsequent dispatches', () => {
      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession()],
        }
      })

      const newProjects = [makeProject({ id: 'proj-2', name: 'New Project' })]
      const newSessions = [makeSession({ id: 'sess-2', projectId: 'proj-2' })]
      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: newProjects,
          sessions: newSessions,
        }
      })

      const state = bus.getState()
      expect(state.projects).toEqual(newProjects)
      expect(state.sessions).toEqual(newSessions)
    })
  })

  describe('sessions:detail dispatch', () => {
    it('should be dispatched without error (currently a no-op on main state)', () => {
      const content: SessionContent = {
        turns: [],
        stats: {
          durationMs: 0,
          turnCount: 0,
          toolCallCount: 0,
          filesAffected: [],
          toolBreakdown: {}
        }
      }

      // sessions:detail is primarily for forwarding to renderer; it should not throw
      expect(() => {
        bus.dispatch({
          type: 'sessions:detail',
          payload: { sessionId: 'sess-1', content }
        })
      }).not.toThrow()
    })
  })

  describe('stats:updated dispatch', () => {
    it('should update stats in state', () => {
      const stats = makeStats()
      bus.dispatch({ type: 'stats:updated', payload: stats })

      const state = bus.getState()
      expect(state.stats).toEqual(stats)
    })

    it('should replace previous stats on subsequent dispatches', () => {
      bus.dispatch({ type: 'stats:updated', payload: makeStats({ todayCostUSD: 1.0 }) })
      bus.dispatch({ type: 'stats:updated', payload: makeStats({ todayCostUSD: 2.5 }) })

      const state = bus.getState()
      expect(state.stats?.todayCostUSD).toBe(2.5)
    })
  })

  describe('tasks:updated dispatch', () => {
    it('should store tasks keyed by sessionId', () => {
      const tasks = [makeTaskFull(), makeTaskFull({ id: 'task-2', subject: 'Another task' })]
      bus.dispatch({
        type: 'tasks:updated',
        payload: { sessionId: 'list-a', tasks }
      })

      const state = bus.getState()
      expect(state.tasks.get('list-a')).toEqual(tasks)
    })

    it('should handle multiple task lists independently', () => {
      const tasksA = [makeTaskFull({ id: 'task-a1' })]
      const tasksB = [makeTaskFull({ id: 'task-b1' }), makeTaskFull({ id: 'task-b2' })]

      bus.dispatch({ type: 'tasks:updated', payload: { sessionId: 'list-a', tasks: tasksA } })
      bus.dispatch({ type: 'tasks:updated', payload: { sessionId: 'list-b', tasks: tasksB } })

      const state = bus.getState()
      expect(state.tasks.get('list-a')?.length).toBe(1)
      expect(state.tasks.get('list-b')?.length).toBe(2)
    })

    it('should replace task list on subsequent dispatch with same sessionId', () => {
      bus.dispatch({
        type: 'tasks:updated',
        payload: { sessionId: 'list-a', tasks: [makeTaskFull({ id: 'task-old' })] }
      })
      bus.dispatch({
        type: 'tasks:updated',
        payload: { sessionId: 'list-a', tasks: [makeTaskFull({ id: 'task-new' })] }
      })

      const state = bus.getState()
      expect(state.tasks.get('list-a')?.length).toBe(1)
      expect(state.tasks.get('list-a')?.[0].id).toBe('task-new')
    })
  })

  describe('tasks:updated -> session taskSummary computation', () => {
    it('should update taskSummary on matching session when tasks change', () => {
      const sessionId = 'sess-1'

      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession({ id: sessionId })],
        }
      })

      bus.dispatch({
        type: 'tasks:updated',
        payload: {
          sessionId,
          tasks: [
            makeTaskFull({ id: '1', status: 'completed' }),
            makeTaskFull({ id: '2', status: 'in_progress' }),
            makeTaskFull({ id: '3', status: 'pending' }),
            makeTaskFull({ id: '4', status: 'pending' })
          ]
        }
      })

      const session = bus.getState().sessions.find((s) => s.id === sessionId)
      expect(session?.taskSummary).toEqual({
        total: 4,
        completed: 1,
        inProgress: 1,
        pending: 2
      })
    })

    it('should not affect sessions that do not match the sessionId', () => {
      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [
            makeSession({ id: 'sess-1' }),
            makeSession({ id: 'sess-2' })
          ],
        }
      })

      bus.dispatch({
        type: 'tasks:updated',
        payload: {
          sessionId: 'sess-1',
          tasks: [makeTaskFull({ id: '1', status: 'completed' })]
        }
      })

      const sess2 = bus.getState().sessions.find((s) => s.id === 'sess-2')
      expect(sess2?.taskSummary).toEqual({
        total: 0, completed: 0, inProgress: 0, pending: 0
      })
    })

    it('should update taskSummary when tasks list changes', () => {
      const sessionId = 'sess-1'

      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession({ id: sessionId })],
        }
      })

      bus.dispatch({
        type: 'tasks:updated',
        payload: {
          sessionId,
          tasks: [makeTaskFull({ id: '1', status: 'pending' })]
        }
      })

      expect(bus.getState().sessions.find((s) => s.id === sessionId)?.taskSummary).toEqual({
        total: 1, completed: 0, inProgress: 0, pending: 1
      })

      bus.dispatch({
        type: 'tasks:updated',
        payload: {
          sessionId,
          tasks: [makeTaskFull({ id: '1', status: 'completed' })]
        }
      })

      expect(bus.getState().sessions.find((s) => s.id === sessionId)?.taskSummary).toEqual({
        total: 1, completed: 1, inProgress: 0, pending: 0
      })
    })
  })

  describe('hooks:event dispatch and accumulation', () => {
    it('should store lifecycle events (eventType !== null)', () => {
      const event = makeHookEvent({ rawEventName: 'SessionStart', eventType: 'session_start' })
      bus.dispatch({ type: 'hooks:event', payload: event })

      expect(bus.getState().hookEvents).toHaveLength(1)
      expect(bus.getState().hookEvents[0]).toEqual(event)
    })

    it('should NOT store operational events (eventType === null)', () => {
      const event = makeHookEvent({ rawEventName: 'PreToolUse', eventType: null })
      bus.dispatch({ type: 'hooks:event', payload: event })

      expect(bus.getState().hookEvents).toHaveLength(0)
    })

    it('should accumulate lifecycle events from different sessions', () => {
      bus.dispatch({ type: 'hooks:event', payload: makeHookEvent({ sessionId: 'sess-1', eventType: 'session_start' }) })
      bus.dispatch({ type: 'hooks:event', payload: makeHookEvent({ sessionId: 'sess-2', eventType: 'session_stop' }) })

      expect(bus.getState().hookEvents).toHaveLength(2)
    })

    it('should still apply operational events to session status', () => {
      const session = makeSession({ id: 'sess-1', status: 'waiting' })
      bus.dispatch({
        type: 'sessions:updated',
        payload: { projects: [makeProject()], sessions: [session] }
      })

      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'sess-1', rawEventName: 'PreToolUse', eventType: null })
      })

      expect(bus.getState().sessions.find((s) => s.id === 'sess-1')?.status).toBe('active')
      expect(bus.getState().hookEvents).toHaveLength(0)
    })

    it('should cap hookEvents at MAX_HOOK_EVENTS', () => {
      for (let i = 0; i < 1100; i++) {
        bus.dispatch({
          type: 'hooks:event',
          payload: makeHookEvent({ sessionId: `sess-${i}`, eventType: 'session_start' })
        })
      }
      expect(bus.getState().hookEvents.length).toBeLessThanOrEqual(1000)
    })
  })

  describe('hooks:event -> session status change (applyHookToSession)', () => {
    function setupSessionAndDispatchHook(
      initialStatus: Session['status'],
      rawEventName: string,
      payload: Record<string, unknown> = {}
    ) {
      const session = makeSession({ id: 'sess-1', status: initialStatus })
      bus.dispatch({
        type: 'sessions:updated',
        payload: { projects: [makeProject()], sessions: [session] }
      })

      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'sess-1', rawEventName, eventType: null, payload })
      })

      return bus.getState()
    }

    it('SessionStart should set session to active', () => {
      const state = setupSessionAndDispatchHook('completed', 'SessionStart')
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('active')
    })

    it('Stop should set session to completed', () => {
      const state = setupSessionAndDispatchHook('active', 'Stop')
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('completed')
    })

    it('Notification with permission_prompt should set session to waiting', () => {
      const state = setupSessionAndDispatchHook('active', 'Notification', { type: 'permission_prompt' })
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('waiting')
    })

    it('Notification with idle_prompt should set session to waiting', () => {
      const state = setupSessionAndDispatchHook('active', 'Notification', { type: 'idle_prompt' })
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('waiting')
    })

    it('Notification with other type should not change session status', () => {
      const state = setupSessionAndDispatchHook('active', 'Notification', { type: 'info' })
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('active')
    })

    it('PreToolUse should set session to active', () => {
      const state = setupSessionAndDispatchHook('waiting', 'PreToolUse')
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('active')
    })

    it('PostToolUse should set session to active', () => {
      const state = setupSessionAndDispatchHook('waiting', 'PostToolUse')
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('active')
    })

    it('PostToolUseFailure should set session to error', () => {
      const state = setupSessionAndDispatchHook('active', 'PostToolUseFailure')
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.status).toBe('error')
    })

    it('should update lastActivity on hook event', () => {
      const now = Date.now()
      const state = setupSessionAndDispatchHook('active', 'PreToolUse')
      const session = state.sessions.find((s) => s.id === 'sess-1')
      expect(session?.lastActivity).toBeGreaterThanOrEqual(now)
    })

    it('should not throw for hook event with unknown session', () => {
      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'unknown-session', rawEventName: 'SessionStart', eventType: 'session_start' })
      })

      // Should store lifecycle event even if session not found
      expect(bus.getState().hookEvents).toHaveLength(1)
    })
  })

  describe('onboarding:status dispatch', () => {
    it('should update onboarding state', () => {
      const onboarding: OnboardingState = { completed: true, hooksInstalled: true }
      bus.dispatch({ type: 'onboarding:status', payload: onboarding })

      expect(bus.getState().onboarding).toEqual(onboarding)
    })
  })

  describe('onBroadcast listener', () => {
    it('should be called on every dispatch with the event', () => {
      const listener = vi.fn()
      bus.onBroadcast(listener)

      const event: DataBusEvent = {
        type: 'stats:updated',
        payload: makeStats()
      }
      bus.dispatch(event)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(event)
    })

    it('should be called for every dispatch', () => {
      const listener = vi.fn()
      bus.onBroadcast(listener)

      bus.dispatch({ type: 'stats:updated', payload: makeStats() })
      bus.dispatch({ type: 'onboarding:status', payload: { completed: true, hooksInstalled: false } })

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('should support multiple listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()
      bus.onBroadcast(listener1)
      bus.onBroadcast(listener2)

      bus.dispatch({ type: 'stats:updated', payload: makeStats() })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })
  })

  describe('onStateChange listener', () => {
    it('should be called with prevState, nextState, and event', () => {
      const listener = vi.fn()
      bus.onStateChange(listener)

      const initialState = bus.getState()
      const event: DataBusEvent = { type: 'stats:updated', payload: makeStats() }
      bus.dispatch(event)

      expect(listener).toHaveBeenCalledTimes(1)
      const [prevState, nextState, receivedEvent] = listener.mock.calls[0] as [AppStateMain, AppStateMain, DataBusEvent]

      expect(prevState.stats).toBeNull()
      expect(nextState.stats).toEqual(makeStats())
      expect(receivedEvent).toEqual(event)
    })

    it('prevState should reflect state before the dispatch', () => {
      const listener = vi.fn()

      bus.dispatch({ type: 'stats:updated', payload: makeStats({ todayCostUSD: 1.0 }) })

      bus.onStateChange(listener)

      bus.dispatch({ type: 'stats:updated', payload: makeStats({ todayCostUSD: 2.0 }) })

      const [prevState, nextState] = listener.mock.calls[0] as [AppStateMain, AppStateMain]
      expect(prevState.stats?.todayCostUSD).toBe(1.0)
      expect(nextState.stats?.todayCostUSD).toBe(2.0)
    })
  })

  describe('onStatusTransition listener', () => {
    it('should fire when hook event changes session status', () => {
      const listener = vi.fn()

      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession({ id: 'sess-1', status: 'active', name: 'Test Session' })],
        }
      })

      bus.onStatusTransition(listener)

      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'sess-1', rawEventName: 'Stop', eventType: 'session_stop' })
      })

      expect(listener).toHaveBeenCalledTimes(1)
      const transition: StatusTransition = listener.mock.calls[0][0]
      expect(transition.sessionId).toBe('sess-1')
      expect(transition.sessionName).toBe('Test Session')
      expect(transition.previousStatus).toBe('active')
      expect(transition.newStatus).toBe('completed')
      expect(transition.timestamp).toBeGreaterThan(0)
    })

    it('should NOT fire when hook event does not change session status', () => {
      const listener = vi.fn()

      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession({ id: 'sess-1', status: 'active' })],
        }
      })

      bus.onStatusTransition(listener)

      // PreToolUse on an already-active session should not trigger transition
      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'sess-1', rawEventName: 'PreToolUse', eventType: null })
      })

      expect(listener).not.toHaveBeenCalled()
    })

    it('should NOT fire for hook events targeting unknown sessions', () => {
      const listener = vi.fn()
      bus.onStatusTransition(listener)

      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'unknown', rawEventName: 'SessionStart', eventType: 'session_start' })
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('unsubscribe', () => {
    it('onBroadcast unsubscribe should stop notifications', () => {
      const listener = vi.fn()
      const unsub = bus.onBroadcast(listener)

      bus.dispatch({ type: 'stats:updated', payload: makeStats() })
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()

      bus.dispatch({ type: 'stats:updated', payload: makeStats() })
      expect(listener).toHaveBeenCalledTimes(1) // still 1, not called again
    })

    it('onStateChange unsubscribe should stop notifications', () => {
      const listener = vi.fn()
      const unsub = bus.onStateChange(listener)

      bus.dispatch({ type: 'stats:updated', payload: makeStats() })
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()

      bus.dispatch({ type: 'stats:updated', payload: makeStats() })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('onStatusTransition unsubscribe should stop notifications', () => {
      const listener = vi.fn()

      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession({ id: 'sess-1', status: 'active' })],
        }
      })

      const unsub = bus.onStatusTransition(listener)

      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'sess-1', rawEventName: 'Stop', eventType: 'session_stop' })
      })
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()

      // Re-set to active so we can transition again
      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession({ id: 'sess-1', status: 'active' })],
        }
      })

      bus.dispatch({
        type: 'hooks:event',
        payload: makeHookEvent({ sessionId: 'sess-1', rawEventName: 'Stop', eventType: 'session_stop' })
      })
      expect(listener).toHaveBeenCalledTimes(1) // still 1
    })
  })

  describe('state immutability', () => {
    it('getState should return a snapshot (modifying returned state does not affect internal state)', () => {
      bus.dispatch({
        type: 'sessions:updated',
        payload: {
          projects: [makeProject()],
          sessions: [makeSession()],
        }
      })

      const state = bus.getState()
      state.projects.push(makeProject({ id: 'injected' }))

      const freshState = bus.getState()
      expect(freshState.projects).toHaveLength(1)
    })
  })
})
