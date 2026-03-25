// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { DataBus } from '../../../electron/core/dataBus'
import type { TaskFull, Session, Project } from '@shared/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '-Users-test-project',
    path: '/Users/test/project',
    name: 'project',
    sessionCount: 1,
    ...overrides
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'abc-123',
    projectId: '-Users-test-project',
    name: 'Test session',
    subtitle: null,
    status: 'active',
    cwd: '/Users/test/project',
    gitBranch: 'main',
    lastActivity: Date.now(),
    startedAt: Date.now(),
    taskSummary: { total: 0, completed: 0, inProgress: 0, pending: 0 },
    ...overrides
  }
}

function makeTaskFull(overrides: Partial<TaskFull> = {}): TaskFull {
  return {
    id: '1',
    subject: 'Fix bug',
    description: 'Fix the critical bug',
    activeForm: 'Fixing bug',
    status: 'pending',
    blocks: [],
    blockedBy: [],
    ...overrides
  }
}

describe('session task lookup', () => {
  it('should return tasks keyed by sessionId, not projectId', () => {
    const bus = new DataBus()
    const sessionId = 'abc-123'
    const projectId = '-Users-test-project'

    // Setup: sessions
    bus.dispatch({
      type: 'sessions:updated',
      payload: {
        projects: [makeProject({ id: projectId })],
        sessions: [makeSession({ id: sessionId, projectId })],
      }
    })

    // Setup: tasks keyed by sessionId (how TaskSource stores them)
    const tasks = [
      makeTaskFull({ id: '1', subject: 'Task A', status: 'in_progress' }),
      makeTaskFull({ id: '2', subject: 'Task B', status: 'completed' })
    ]
    bus.dispatch({
      type: 'tasks:updated',
      payload: { sessionId, tasks }
    })

    // Verify tasks are retrievable by sessionId
    const state = bus.getState()
    const result = state.tasks.get(sessionId)

    expect(result).toBeDefined()
    expect(result).toHaveLength(2)
    expect(result![0].subject).toBe('Task A')

    // Verify projectId does NOT work as key
    expect(state.tasks.get(projectId)).toBeUndefined()
  })
})
