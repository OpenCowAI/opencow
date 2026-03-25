// SPDX-License-Identifier: Apache-2.0

import type { ViewFilters, EphemeralFilters, IssueQueryFilter, TimeFilter } from './types'

interface ResolveContext {
  sidebarProjectId: string | null
  isAllView: boolean
}

/**
 * Merge a view's persistent filters with runtime ephemeral filters into
 * a single `IssueQueryFilter` ready for the backend.
 *
 * Filter array semantics:
 *   - `undefined`       → "no constraint" (match everything)
 *   - Non-empty `T[]`   → "restrict to these values"
 *   - `[]` (empty)      → INVALID input; normalized to `undefined` at entry
 *
 * When both view and ephemeral carry constraints on the same dimension,
 * the result is their set-intersection.  An empty intersection (e.g.
 * view says "todo" but ephemeral says "done") produces `[]` in the
 * output, which correctly represents "no value can satisfy both
 * constraints → zero matches".
 */
export function resolveToQuery(
  viewFilters: ViewFilters,
  ephemeralFilters: EphemeralFilters,
  context: ResolveContext,
): IssueQueryFilter {
  // ── Normalize inputs ──────────────────────────────────────────────
  // Empty arrays can leak in from DB persistence or UI state transitions.
  // Semantically they mean "no constraint" (same as undefined), but the
  // original JS truthy check `![]` is `false`, so `intersectArrays`
  // would treat them as a real (but impossible) constraint.
  // Normalizing here — the single query-building entry point — ensures
  // every downstream function sees clean inputs.
  const vf: ViewFilters = {
    ...viewFilters,
    statuses: nonEmpty(viewFilters.statuses),
    priorities: nonEmpty(viewFilters.priorities),
    labels: nonEmpty(viewFilters.labels),
  }
  const ef: EphemeralFilters = {
    ...ephemeralFilters,
    statuses: nonEmpty(ephemeralFilters.statuses),
    priorities: nonEmpty(ephemeralFilters.priorities),
    labels: nonEmpty(ephemeralFilters.labels),
  }

  const query: IssueQueryFilter = {}

  // Multi-value fields: intersect view filters with ephemeral filters
  query.statuses = intersectArrays(vf.statuses, ef.statuses)
  query.priorities = intersectArrays(vf.priorities, ef.priorities)
  query.labels = intersectArrays(vf.labels, ef.labels)

  // Project: view's own config takes precedence; falls back to sidebar selection
  query.projectId =
    vf.projectId ?? (context.sidebarProjectId ?? undefined)

  // Search: ephemeral layer only
  query.search = ef.search || undefined

  // Time: resolve relative filters to absolute timestamps
  if (vf.created) {
    const range = resolveTimeFilter(vf.created)
    query.createdAfter = range.after
    query.createdBefore = range.before
  }
  if (vf.updated) {
    const range = resolveTimeFilter(vf.updated)
    query.updatedAfter = range.after
    query.updatedBefore = range.before
  }

  // Session
  if (vf.session) {
    query.hasSession = vf.session.exists
    query.sessionStates = vf.session.states
  }

  // Strip undefined fields to ensure clean IPC transport
  return stripUndefined(query)
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Return `undefined` when the array is absent or empty; otherwise pass through. */
function nonEmpty<T>(arr?: T[]): T[] | undefined {
  return arr && arr.length > 0 ? arr : undefined
}

/**
 * Intersect two optional filter arrays.
 *
 * Semantics (inputs are already normalized by `nonEmpty`):
 *   - `undefined` → "no constraint" (match everything).
 *   - Non-empty array → "restrict to these values".
 *
 * When both sides carry constraints, the result is their intersection.
 * An empty intersection means no value can satisfy both constraints,
 * so we return `[]` (zero matches) — this is intentional and distinct
 * from `undefined` (no constraint).
 */
function intersectArrays<T>(a?: T[], b?: T[]): T[] | undefined {
  if (!a && !b) return undefined
  if (!a) return b
  if (!b) return a
  const setB = new Set(b)
  return a.filter((item) => setB.has(item))
}

function resolveTimeFilter(filter: TimeFilter): { after: number; before?: number } {
  if (filter.type === 'absolute') {
    return { after: filter.after, before: filter.before }
  }
  const now = Date.now()
  const DAY = 86_400_000
  switch (filter.value) {
    case 'today':
      return { after: startOfDay(now) }
    case 'this_week':
      return { after: startOfWeek(now) }
    case 'this_month':
      return { after: startOfMonth(now) }
    case 'last_7d':
      return { after: now - 7 * DAY }
    case 'last_30d':
      return { after: now - 30 * DAY }
  }
}

function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfWeek(ts: number): number {
  const d = new Date(ts)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday as start of week
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfMonth(ts: number): number {
  const d = new Date(ts)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Strip `undefined` values from a filter object for clean IPC transport.
 *
 * NOTE: empty arrays `[]` are intentionally KEPT — they represent
 * "empty intersection" (conflict between constraints → zero matches),
 * which is semantically different from `undefined` (no constraint).
 */
function stripUndefined<T extends object>(obj: T): T {
  const result = {} as T
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue
    ;(result as Record<string, unknown>)[key] = value
  }
  return result
}
