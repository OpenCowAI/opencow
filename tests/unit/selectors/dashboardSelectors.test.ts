// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  selectDashboardStats,
  selectActivityData,
  selectProjectRanking,
  selectRecentActivity
} from '../../../src/renderer/selectors/dashboardSelectors'
import type {
  Session,
  StatsSnapshot,
  TaskFull,
  ManagedSessionInfo,
  IssueSummary
} from '../../../src/shared/types'
import type { SessionStatusCounts } from '../../../src/renderer/hooks/useSessionStatusCounts'

// --- Test fixtures ---

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    projectId: 'proj-1',
    name: 'Test Session',
    subtitle: null,
    status: 'completed',
    cwd: '/tmp/proj',
    gitBranch: 'main',
    lastActivity: Date.now(),
    startedAt: Date.now() - 3600_000,
    taskSummary: { total: 0, completed: 0, inProgress: 0, pending: 0 },
    ...overrides
  }
}

function makeTask(overrides: Partial<TaskFull> = {}): TaskFull {
  return {
    id: 'task-1',
    subject: 'Test task',
    description: '',
    activeForm: '',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides
  }
}

function makeManagedSession(overrides: Partial<ManagedSessionInfo> = {}): ManagedSessionInfo {
  return {
    id: 'ms-1',
    engineKind: 'claude',
    engineSessionRef: null,

    engineState: null,
    state: 'idle',
    stopReason: null,
    origin: { source: 'agent' },
    projectPath: '/tmp/proj',
    projectId: 'proj-1',
    model: null,
    messages: [],
    createdAt: Date.now() - 3600_000,
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
    ...overrides
  }
}

function makeIssue(overrides: Partial<IssueSummary> = {}): IssueSummary {
  return {
    id: 'issue-1',
    title: 'Test issue',
    status: 'todo',
    priority: 'medium',
    labels: [],
    projectId: 'proj-1',
    sessionId: null,
    parentIssueId: null,
    createdAt: Date.now() - 3600_000,
    updatedAt: Date.now(),
    readAt: null,
    lastAgentActivityAt: null,
    ...overrides
  }
}

const defaultStats: StatsSnapshot = {
  todayCostUSD: 1.5,
  todayTokens: 50000,
  todaySessions: 3,
  todayToolCalls: 42,
  totalSessions: 100,
  totalMessages: 500
}

const emptyTasksByList: Record<string, TaskFull[]> = {}

// --- selectDashboardStats ---

describe('selectDashboardStats', () => {
  it('computes global stats from all sessions and tasks', () => {
    const sessions = [
      makeSession({ id: 's1', status: 'active' }),
      makeSession({ id: 's2', status: 'completed' }),
      makeSession({ id: 's3', status: 'active' })
    ]
    const tasksByList: Record<string, TaskFull[]> = {
      'list-a': [
        makeTask({ id: 't1', status: 'completed' }),
        makeTask({ id: 't2', status: 'completed' }),
        makeTask({ id: 't3', status: 'in_progress' })
      ],
      'list-b': [
        makeTask({ id: 't4', status: 'pending' }),
        makeTask({ id: 't5', status: 'completed' })
      ]
    }
    const issues = [
      makeIssue({ id: 'i1', status: 'done' }),
      makeIssue({ id: 'i2', status: 'done' }),
      makeIssue({ id: 'i3', status: 'in_progress' }),
      makeIssue({ id: 'i4', status: 'todo' }),
      makeIssue({ id: 'i5', status: 'backlog' }),
      makeIssue({ id: 'i6', status: 'cancelled' })
    ]
    const result = selectDashboardStats({
      sessions,
      issues,
      stats: defaultStats,
      tasksByList,
      selectedProjectId: null
    })

    expect(result.totalSessions).toBe(3)
    expect(result.sessionStatusCounts).toEqual<SessionStatusCounts>({
      active: 2,
      waiting: 0,
      completed: 1,
      error: 0
    })
    expect(result.totalTasks).toBe(5)
    expect(result.taskCompletionRate).toBeCloseTo(3 / 5)
    expect(result.totalIssues).toBe(6)
    expect(result.issueCompletionRate).toBeCloseTo(2 / 6)
    expect(result.issueStatusCounts).toEqual({
      backlog: 1,
      todo: 1,
      in_progress: 1,
      done: 2,
      cancelled: 1
    })
    expect(result.todayTokens).toBe(50000)
    expect(result.todayCost).toBe(1.5)
  })

  it('filters sessions by selectedProjectId', () => {
    const sessions = [
      makeSession({ id: 's1', projectId: 'proj-a', status: 'active' }),
      makeSession({ id: 's2', projectId: 'proj-b', status: 'active' })
    ]
    const issues = [
      makeIssue({ id: 'i1', projectId: 'proj-a', status: 'done' }),
      makeIssue({ id: 'i2', projectId: 'proj-b', status: 'in_progress' })
    ]
    const result = selectDashboardStats({
      sessions,
      issues,
      stats: defaultStats,
      tasksByList: emptyTasksByList,
      selectedProjectId: 'proj-a'
    })

    expect(result.totalSessions).toBe(1)
    expect(result.sessionStatusCounts).toEqual<SessionStatusCounts>({
      active: 1,
      waiting: 0,
      completed: 0,
      error: 0
    })
    expect(result.totalIssues).toBe(1)
    expect(result.issueCompletionRate).toBe(1)
    expect(result.issueStatusCounts).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 0,
      done: 1,
      cancelled: 0
    })
  })

  it('handles zero sessions and tasks', () => {
    const result = selectDashboardStats({
      sessions: [],
      issues: [],
      stats: null,
      tasksByList: emptyTasksByList,
      selectedProjectId: null
    })

    expect(result.totalSessions).toBe(0)
    expect(result.sessionStatusCounts).toEqual<SessionStatusCounts>({
      active: 0,
      waiting: 0,
      completed: 0,
      error: 0
    })
    expect(result.totalTasks).toBe(0)
    expect(result.taskCompletionRate).toBe(0)
    expect(result.totalIssues).toBe(0)
    expect(result.issueCompletionRate).toBe(0)
    expect(result.issueStatusCounts).toEqual({
      backlog: 0,
      todo: 0,
      in_progress: 0,
      done: 0,
      cancelled: 0
    })
    expect(result.todayTokens).toBe(0)
    expect(result.todayCost).toBe(0)
  })
})

// --- selectActivityData ---

describe('selectActivityData', () => {
  it('aggregates managed sessions by day in { day, value } format', () => {
    const dayMs = 86400_000
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTs = today.getTime()

    const managedSessions = [
      makeManagedSession({ id: 'ms1', createdAt: todayTs + 1000 }),
      makeManagedSession({ id: 'ms2', createdAt: todayTs + 2000 }),
      makeManagedSession({ id: 'ms3', createdAt: todayTs - dayMs + 1000 })
    ]
    const result = selectActivityData({ managedSessions, selectedProjectId: null })

    const todayStr = today.toISOString().slice(0, 10)
    const yesterdayStr = new Date(todayTs - dayMs).toISOString().slice(0, 10)

    const todayEntry = result.find((d) => d.day === todayStr)
    const yesterdayEntry = result.find((d) => d.day === yesterdayStr)

    expect(todayEntry?.value).toBe(2)
    expect(yesterdayEntry?.value).toBe(1)
  })

  it('returns empty array for no sessions', () => {
    const result = selectActivityData({ managedSessions: [], selectedProjectId: null })
    expect(result).toEqual([])
  })

  it('filters by selectedProjectId', () => {
    const todayTs = new Date().setHours(0, 0, 0, 0)
    const managedSessions = [
      makeManagedSession({ id: 'ms1', projectId: 'proj-a', createdAt: todayTs + 1000 }),
      makeManagedSession({ id: 'ms2', projectId: 'proj-b', createdAt: todayTs + 2000 })
    ]
    const result = selectActivityData({ managedSessions, selectedProjectId: 'proj-a' })
    expect(result.length).toBe(1)
    expect(result[0].value).toBe(1)
  })
})

// --- selectProjectRanking ---

describe('selectProjectRanking', () => {
  it('returns top 5 projects sorted by session count descending', () => {
    const sessions = [
      ...Array.from({ length: 8 }, (_, i) => makeSession({ id: `s-a-${i}`, projectId: 'proj-a' })),
      ...Array.from({ length: 3 }, (_, i) => makeSession({ id: `s-b-${i}`, projectId: 'proj-b' })),
      ...Array.from({ length: 12 }, (_, i) => makeSession({ id: `s-c-${i}`, projectId: 'proj-c' }))
    ]
    const result = selectProjectRanking({
      sessions,
      projects: [
        { id: 'proj-a', path: '/a', name: 'Project A', sessionCount: 8, activeSessionCount: 0 },
        { id: 'proj-b', path: '/b', name: 'Project B', sessionCount: 3, activeSessionCount: 0 },
        { id: 'proj-c', path: '/c', name: 'Project C', sessionCount: 12, activeSessionCount: 0 }
      ]
    })

    expect(result[0].projectName).toBe('Project C')
    expect(result[0].sessionCount).toBe(12)
    expect(result[1].projectName).toBe('Project A')
    expect(result[1].sessionCount).toBe(8)
    expect(result[2].projectName).toBe('Project B')
    expect(result.length).toBeLessThanOrEqual(5)
  })
})

// --- selectRecentActivity ---

describe('selectRecentActivity', () => {
  it('returns most recent 10 sessions sorted by lastActivity desc', () => {
    const now = Date.now()
    const sessions = Array.from({ length: 15 }, (_, i) =>
      makeSession({ id: `s-${i}`, lastActivity: now - i * 60000, name: `Session ${i}` })
    )
    const result = selectRecentActivity({ sessions, projects: [], selectedProjectId: null })

    expect(result.length).toBe(10)
    expect(result[0].sessionName).toBe('Session 0')
    expect(result[9].sessionName).toBe('Session 9')
  })

  it('filters by selectedProjectId', () => {
    const now = Date.now()
    const sessions = [
      makeSession({ id: 's1', projectId: 'proj-a', lastActivity: now, name: 'A' }),
      makeSession({ id: 's2', projectId: 'proj-b', lastActivity: now - 1000, name: 'B' })
    ]
    const result = selectRecentActivity({ sessions, projects: [], selectedProjectId: 'proj-a' })

    expect(result.length).toBe(1)
    expect(result[0].sessionName).toBe('A')
  })
})
