// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { computeSessionStatusCounts } from '../../../src/renderer/hooks/useSessionStatusCounts'
import type { Session } from '../../../src/shared/types'

function makeSession(status: Session['status']): Session {
  return {
    id: `sess-${Math.random()}`,
    projectId: 'proj-1',
    name: 'Test',
    subtitle: null,
    status,
    cwd: '/tmp',
    gitBranch: null,
    lastActivity: Date.now(),
    startedAt: Date.now(),
    taskSummary: { total: 0, completed: 0, inProgress: 0, pending: 0 },
  }
}

describe('computeSessionStatusCounts', () => {
  it('returns zero counts for empty array', () => {
    const result = computeSessionStatusCounts([])
    expect(result).toEqual({ active: 0, waiting: 0, completed: 0, error: 0 })
  })

  it('counts each status correctly', () => {
    const sessions = [
      makeSession('active'),
      makeSession('active'),
      makeSession('waiting'),
      makeSession('error'),
      makeSession('completed'),
      makeSession('completed'),
      makeSession('completed'),
    ]
    const result = computeSessionStatusCounts(sessions)
    expect(result).toEqual({ active: 2, waiting: 1, completed: 3, error: 1 })
  })

  it('handles single status', () => {
    const sessions = [makeSession('waiting'), makeSession('waiting')]
    const result = computeSessionStatusCounts(sessions)
    expect(result.waiting).toBe(2)
    expect(result.active).toBe(0)
  })
})
