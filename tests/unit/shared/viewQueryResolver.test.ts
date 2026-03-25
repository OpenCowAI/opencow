// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveToQuery } from '../../../src/shared/viewQueryResolver'
import type { ViewFilters, EphemeralFilters } from '../../../src/shared/types'

describe('resolveToQuery', () => {
  const FIXED_NOW = 1709078400000 // 2024-02-28T00:00:00Z (Wednesday)
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const defaultCtx = { sidebarProjectId: null, isAllView: false }

  // ── Basic behavior ──

  it('returns empty filter when both sides are empty', () => {
    const result = resolveToQuery({}, {}, defaultCtx)
    expect(result.statuses).toBeUndefined()
    expect(result.priorities).toBeUndefined()
    expect(result.labels).toBeUndefined()
    expect(result.projectId).toBeUndefined()
    expect(result.search).toBeUndefined()
  })

  // ── Multi-value field intersection logic ──

  it('uses view statuses directly when no ephemeral statuses', () => {
    const view: ViewFilters = { statuses: ['todo', 'in_progress'] }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.statuses).toEqual(['todo', 'in_progress'])
  })

  it('intersects view and ephemeral statuses', () => {
    const view: ViewFilters = { statuses: ['todo', 'in_progress', 'done'] }
    const eph: EphemeralFilters = { statuses: ['todo', 'done'] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.statuses).toEqual(['todo', 'done'])
  })

  it('uses ephemeral statuses when view has no statuses', () => {
    const eph: EphemeralFilters = { statuses: ['todo'] }
    const result = resolveToQuery({}, eph, defaultCtx)
    expect(result.statuses).toEqual(['todo'])
  })

  it('returns empty array when intersection is empty', () => {
    const view: ViewFilters = { statuses: ['todo'] }
    const eph: EphemeralFilters = { statuses: ['done'] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.statuses).toEqual([])
  })

  it('applies the same intersection logic to priorities', () => {
    const view: ViewFilters = { priorities: ['urgent', 'high'] }
    const eph: EphemeralFilters = { priorities: ['high'] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.priorities).toEqual(['high'])
  })

  it('applies the same intersection logic to labels', () => {
    const view: ViewFilters = { labels: ['bug', 'perf'] }
    const eph: EphemeralFilters = { labels: ['bug', 'feature'] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.labels).toEqual(['bug'])
  })

  // ── Empty-array input normalization ──
  // Empty arrays can leak from DB persistence or UI state transitions.
  // They must be treated as "no constraint" (same as undefined), NOT as
  // a real filter with zero values.

  it('normalizes empty view labels to undefined (no constraint)', () => {
    const view: ViewFilters = { statuses: ['in_progress'], labels: [] }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.statuses).toEqual(['in_progress'])
    expect(result.labels).toBeUndefined()
  })

  it('normalizes empty ephemeral labels to undefined (no constraint)', () => {
    const view: ViewFilters = { statuses: ['in_progress'] }
    const eph: EphemeralFilters = { labels: [] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.statuses).toEqual(['in_progress'])
    expect(result.labels).toBeUndefined()
  })

  it('normalizes empty arrays on both sides to undefined', () => {
    const view: ViewFilters = { statuses: ['in_progress'], labels: [] }
    const eph: EphemeralFilters = { labels: [] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.statuses).toEqual(['in_progress'])
    expect(result.labels).toBeUndefined()
  })

  it('normalizes empty statuses/priorities too', () => {
    const view: ViewFilters = { statuses: [], priorities: [], labels: [] }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.statuses).toBeUndefined()
    expect(result.priorities).toBeUndefined()
    expect(result.labels).toBeUndefined()
  })

  it('non-empty ephemeral labels still work with empty view labels', () => {
    const view: ViewFilters = { statuses: ['in_progress'], labels: [] }
    const eph: EphemeralFilters = { labels: ['bug'] }
    const result = resolveToQuery(view, eph, defaultCtx)
    expect(result.statuses).toEqual(['in_progress'])
    // View labels normalized to undefined → no constraint → ephemeral labels pass through
    expect(result.labels).toEqual(['bug'])
  })

  // ── Project x Sidebar interaction ──

  it('view projectId takes precedence over sidebar', () => {
    const view: ViewFilters = { projectId: 'proj-a' }
    const ctx = { sidebarProjectId: 'proj-b', isAllView: false }
    const result = resolveToQuery(view, {}, ctx)
    expect(result.projectId).toBe('proj-a')
  })

  it('falls back to sidebar when custom view has no projectId', () => {
    const ctx = { sidebarProjectId: 'proj-b', isAllView: false }
    const result = resolveToQuery({}, {}, ctx)
    expect(result.projectId).toBe('proj-b')
  })

  it('All view uses sidebar projectId when it has no projectId', () => {
    const ctx = { sidebarProjectId: 'proj-b', isAllView: true }
    const result = resolveToQuery({}, {}, ctx)
    expect(result.projectId).toBe('proj-b')
  })

  it('no filtering when sidebar is null and view has no projectId', () => {
    const ctx = { sidebarProjectId: null, isAllView: false }
    const result = resolveToQuery({}, {}, ctx)
    expect(result.projectId).toBeUndefined()
  })

  // ── Search (ephemeral layer only) ──

  it('passes through ephemeral search', () => {
    const eph: EphemeralFilters = { search: 'auth bug' }
    const result = resolveToQuery({}, eph, defaultCtx)
    expect(result.search).toBe('auth bug')
  })

  it('empty search does not appear in result', () => {
    const eph: EphemeralFilters = { search: '' }
    const result = resolveToQuery({}, eph, defaultCtx)
    expect(result.search).toBeUndefined()
  })

  // ── Time filters ──

  it('resolves relative time: today', () => {
    const view: ViewFilters = { created: { type: 'relative', value: 'today' } }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.createdAfter).toBeDefined()
    // Start time for today should be at 00:00:00 of the current day
    const todayStart = new Date(FIXED_NOW)
    todayStart.setHours(0, 0, 0, 0)
    expect(result.createdAfter).toBe(todayStart.getTime())
  })

  it('resolves relative time: this_week', () => {
    const view: ViewFilters = { created: { type: 'relative', value: 'this_week' } }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.createdAfter).toBeDefined()
    expect(result.createdAfter!).toBeLessThanOrEqual(FIXED_NOW)
    expect(result.createdAfter!).toBeGreaterThan(FIXED_NOW - 8 * 86_400_000)
  })

  it('resolves relative time: last_7d', () => {
    const view: ViewFilters = { updated: { type: 'relative', value: 'last_7d' } }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.updatedAfter).toBe(FIXED_NOW - 7 * 86_400_000)
  })

  it('resolves relative time: last_30d', () => {
    const view: ViewFilters = { updated: { type: 'relative', value: 'last_30d' } }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.updatedAfter).toBe(FIXED_NOW - 30 * 86_400_000)
  })

  it('resolves absolute time filter', () => {
    const view: ViewFilters = {
      updated: { type: 'absolute', after: 100000, before: 200000 },
    }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.updatedAfter).toBe(100000)
    expect(result.updatedBefore).toBe(200000)
  })

  it('only has after when absolute time has no before', () => {
    const view: ViewFilters = {
      created: { type: 'absolute', after: 100000 },
    }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.createdAfter).toBe(100000)
    expect(result.createdBefore).toBeUndefined()
  })

  // ── Session filters ──

  it('passes through session existence filter', () => {
    const view: ViewFilters = { session: { exists: true } }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.hasSession).toBe(true)
    expect(result.sessionStates).toBeUndefined()
  })

  it('passes through session state filter', () => {
    const view: ViewFilters = { session: { exists: true, states: ['error', 'streaming'] } }
    const result = resolveToQuery(view, {}, defaultCtx)
    expect(result.hasSession).toBe(true)
    expect(result.sessionStates).toEqual(['error', 'streaming'])
  })

  // ── Combined scenarios ──

  it('full combination: view + ephemeral + sidebar', () => {
    const view: ViewFilters = {
      statuses: ['todo', 'in_progress'],
      priorities: ['urgent', 'high'],
      labels: ['bug'],
      created: { type: 'relative', value: 'this_week' },
      session: { exists: true },
    }
    const eph: EphemeralFilters = {
      statuses: ['todo'],
      search: 'crash',
    }
    const ctx = { sidebarProjectId: 'proj-x', isAllView: false }

    const result = resolveToQuery(view, eph, ctx)
    expect(result.statuses).toEqual(['todo']) // intersection
    expect(result.priorities).toEqual(['urgent', 'high']) // passed through from view
    expect(result.labels).toEqual(['bug']) // passed through from view
    expect(result.search).toBe('crash') // ephemeral layer
    expect(result.projectId).toBe('proj-x') // falls back to sidebar
    expect(result.createdAfter).toBeDefined() // time resolved
    expect(result.hasSession).toBe(true) // session filter
  })
})
