// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type {
  IssueView,
  IssueQueryFilter,
  ViewFilters,
  ViewDisplayConfig,
  EphemeralFilters,
  TimeFilter,
  SessionFilter,
  SortConfig,
  GroupByField,
  RelativeTime,
  CreateIssueViewInput,
  UpdateIssueViewInput,
} from '../../../src/shared/types'
import { ALL_VIEW } from '../../../src/shared/types'

describe('IssueView types', () => {
  it('ALL_VIEW is a valid IssueView constant', () => {
    expect(ALL_VIEW.id).toBe('__all__')
    expect(ALL_VIEW.filters).toEqual({})
    expect(ALL_VIEW.display.groupBy).toBeNull()
    expect(ALL_VIEW.display.sort).toEqual({ field: 'updatedAt', order: 'desc' })
    expect(ALL_VIEW.position).toBe(-1)
  })

  it('IssueView satisfies structural constraints', () => {
    const view: IssueView = {
      id: 'test-id',
      name: 'High Priority Bugs',
      icon: '🔴',
      filters: {
        statuses: ['todo', 'in_progress'],
        priorities: ['urgent', 'high'],
        labels: ['bug'],
        session: { exists: true, states: ['error'] },
        created: { type: 'relative', value: 'this_week' },
      },
      display: { groupBy: 'status', sort: { field: 'priority', order: 'asc' } },
      position: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    expect(view.name).toBe('High Priority Bugs')
  })

  it('IssueQueryFilter supports multi-value fields', () => {
    const filter: IssueQueryFilter = {
      statuses: ['todo', 'in_progress'],
      priorities: ['urgent', 'high'],
      labels: ['bug', 'perf'],
      projectId: 'proj-1',
      search: 'auth',
      createdAfter: 1708905600000,
      updatedAfter: 1708905600000,
      hasSession: true,
      sessionStates: ['streaming'],
      sort: { field: 'priority', order: 'asc' },
    }
    expect(filter.statuses).toHaveLength(2)
  })

  it('TimeFilter is a discriminated union', () => {
    const relative: TimeFilter = { type: 'relative', value: 'this_week' }
    const absolute: TimeFilter = {
      type: 'absolute',
      after: 1708905600000,
      before: 1709510400000,
    }
    expect(relative.type).toBe('relative')
    expect(absolute.type).toBe('absolute')
  })

  it('EphemeralFilters has correct structure', () => {
    const eph: EphemeralFilters = {
      statuses: ['todo'],
      priorities: ['urgent'],
      labels: ['bug'],
      search: 'test query',
    }
    expect(eph.search).toBe('test query')
  })

  it('CreateIssueViewInput has correct structure', () => {
    const input: CreateIssueViewInput = {
      name: 'My View',
      icon: '🚀',
      filters: { statuses: ['todo'] },
      display: { groupBy: null, sort: { field: 'updatedAt', order: 'desc' } },
    }
    expect(input.name).toBe('My View')
  })

  it('UpdateIssueViewInput supports partial updates', () => {
    const patch: UpdateIssueViewInput = { name: 'Renamed' }
    expect(patch.name).toBe('Renamed')
    expect(patch.filters).toBeUndefined()
  })
})
