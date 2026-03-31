// SPDX-License-Identifier: Apache-2.0

/**
 * issueStore — Issue domain data: CRUD, caching, normalization, views, labels.
 *
 * Owns all issue data and issue-view configuration that is NOT part of
 * the per-project state machine (`_projectStates`).  Per-project UI
 * state (`selectedIssueId`, `activeViewId`, `ephemeralFilters`,
 * `allViewDisplay`) remains in appStore because it participates in
 * the atomic save/restore cycle during project transitions.
 *
 * Cross-store reads:
 *   - `loadIssues` reads view config (activeViewId, ephemeralFilters,
 *     allViewDisplay, appView) from `useAppStore.getState()`.
 *   - `loadViewIssueCounts` reads activeViewId and appView from appStore.
 *
 * Cross-store writes are handled by action coordinators in
 * `issueActions.ts` (selectIssue, deleteIssue, deleteIssueView,
 * updateIssueView) — never by this store directly.
 *
 * Populated by:
 *   - bootstrapCoordinator (setIssuesFromInitialLoad, loadCustomLabels)
 *   - DataBus events in useAppBootstrap (issues:invalidated → loadIssues)
 *   - User interactions (CRUD, label management, view management)
 */

import { create } from 'zustand'
import type {
  Issue,
  IssueSummary,
  IssueView,
  ViewDisplayConfig,
  CreateIssueViewInput,
  UpdateIssueViewInput,
  CreateIssueInput,
  UpdateIssueInput,
} from '@shared/types'
import { ALL_VIEW } from '@shared/types'
import { resolveToQuery } from '@shared/viewQueryResolver'
import { getAppAPI } from '@/windowAPI'
import { queryIssueSummaries } from '@/lib/query/issueQueryService'
import { fireAndForget } from '@/lib/asyncUtils'
// Circular dependency note: issueStore ↔ appStore reference each other.
// ESM live bindings handle this correctly — useAppStore is only accessed
// inside store methods (never at module evaluation time), so by the time
// any method runs, both modules are fully initialised.
import { useAppStore } from './appStore'

// ─── Issue Normalization Helpers ─────────────────────────────────────

/** Convert an array of issues into normalized { issueById, issueIds } form. */
function normalizeIssues(
  issues: IssueSummary[],
): { issueById: Record<string, IssueSummary>; issueIds: string[] } {
  const issueById: Record<string, IssueSummary> = {}
  const issueIds: string[] = new Array(issues.length)
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i]
    issueById[issue.id] = issue
    issueIds[i] = issue.id
  }
  return { issueById, issueIds }
}

// Monotonic counter that guards against stale loadIssues responses.
// Each call to loadIssues increments the counter; when the async IPC
// resolves, the result is discarded if a newer request has been made.
let _loadIssuesSeq = 0

// De-duplication map for loadIssueDetail: prevents concurrent requests for
// the same issue ID (e.g. selectIssue + component effect both calling it).
const _issueDetailInflight = new Map<string, Promise<Issue | null>>()

// Monotonic counter that guards against stale loadViewIssueCounts responses.
// Same pattern as _loadIssuesSeq — prevents a slow count query from overwriting
// results of a newer query triggered by a rapid view/project switch.
let _loadCountsSeq = 0

// ─── readAt Patch Helper ─────────────────────────────────────────────

/**
 * Build a partial-state updater that patches `readAt` in both the normalized
 * `issueById` map and the `issueDetailCache`.  Shared by markIssueRead and
 * markIssueUnread to eliminate duplicated set() callbacks.
 */
function patchReadAt(
  s: Pick<IssueStore, 'issueById' | 'issueDetailCache'>,
  id: string,
  readAt: number | null,
): Partial<IssueStore> {
  const nextCache = new Map(s.issueDetailCache)
  const cached = nextCache.get(id)
  if (cached) nextCache.set(id, { ...cached, readAt })
  const existing = s.issueById[id]
  if (!existing) return { issueDetailCache: nextCache }
  return {
    issueById: { ...s.issueById, [id]: { ...existing, readAt } },
    issueDetailCache: nextCache,
  }
}

// ─── Store Interface ────────────────────────────────────────────────

export interface IssueStore {
  // ── Issue Data (normalized) ───────────────────────────────────────
  /**
   * Normalized issue lookup — O(1) access by ID.
   * Together with `issueIds`, replaces the old flat `issues: IssueSummary[]` array.
   */
  issueById: Record<string, IssueSummary>
  /** Ordered issue IDs for the current view (preserves sort/filter order). */
  issueIds: string[]
  /**
   * Cache of fully-loaded Issue objects, keyed by issue ID.
   * Replaces the old single-slot `activeIssue` to enable instant switching
   * between previously visited issues (stale-while-revalidate pattern).
   */
  issueDetailCache: Map<string, Issue>
  childIssuesCache: Record<string, IssueSummary[]>

  // ── Custom Labels ─────────────────────────────────────────────────
  /** User-created custom labels (loaded from backend). */
  customLabels: string[]

  // ── Issue Views ───────────────────────────────────────────────────
  issueViews: IssueView[]
  /** Issue count per view id (including ALL_VIEW). Refreshed after each loadIssues. */
  viewIssueCounts: Record<string, number>

  // ── Issue Data Operations ─────────────────────────────────────────
  loadIssues: () => Promise<void>
  setIssuesFromInitialLoad: (issues: IssueSummary[]) => void
  /**
   * Load full issue data for the detail view. Guards against race conditions.
   * Returns the loaded Issue on success, or null when the issue does not exist.
   * Concurrent calls for the same ID are de-duplicated (single network request).
   */
  loadIssueDetail: (id: string) => Promise<Issue | null>
  /**
   * Pre-fetch full issue detail into cache without affecting selection state.
   * Called on hover to anticipate user clicks — data is ready before they act.
   */
  prefetchIssueDetail: (id: string) => void
  createIssue: (input: CreateIssueInput) => Promise<Issue>
  updateIssue: (id: string, patch: UpdateIssueInput) => Promise<void>
  /**
   * Lightweight in-memory patch for a single issue field.
   *
   * Used by cross-store side effects (session→issue status sync) that
   * only need to update one field on the hot path. Unlike `updateIssue()`,
   * this does NOT:
   *   - Call the backend IPC (no 'update-issue' round-trip)
   *   - Call `loadIssues()` (no full query + normalization)
   *   - Trigger `loadViewIssueCounts()` (no count refresh)
   *
   * Updates BOTH `issueById` AND `issueDetailCache` so that list views
   * and detail views stay consistent (mirrors the dual-write pattern
   * of `patchReadAt()`).
   *
   * The caller is responsible for persisting to the backend separately
   * (typically via fire-and-forget IPC).
   */
  patchIssueOptimistic: (id: string, patch: Partial<IssueSummary>) => void
  /**
   * Delete issue data: IPC + evict from caches + reload list.
   * Does NOT handle navigation cleanup — that's in issueActions.deleteIssue.
   */
  deleteIssueData: (id: string) => Promise<boolean>
  loadChildIssues: (parentId: string) => Promise<IssueSummary[]>
  /**
   * Batch-update multiple issues with the same patch.
   * Returns updated issues; reloads list afterward.
   */
  batchUpdateIssues: (ids: string[], patch: UpdateIssueInput) => Promise<Issue[]>
  /** Mark an issue as read — updates `readAt` without bumping `updatedAt`. */
  markIssueRead: (id: string) => Promise<void>
  /** Manually mark an issue as unread — sets `readAt` to 0 sentinel value. */
  markIssueUnread: (id: string) => Promise<void>

  // ── Custom Label Operations ───────────────────────────────────────
  /** Load custom labels from backend. */
  loadCustomLabels: () => Promise<void>
  /** Create a new custom label and refresh the list. */
  createCustomLabel: (label: string) => Promise<void>
  /** Delete a custom label and refresh the list. */
  deleteCustomLabel: (label: string) => Promise<void>
  /** Rename a custom label and refresh the list. */
  updateCustomLabel: (oldLabel: string, newLabel: string) => Promise<void>

  // ── Issue View Operations ─────────────────────────────────────────
  loadIssueViews: () => Promise<void>
  loadViewIssueCounts: () => Promise<void>
  createIssueView: (input: CreateIssueViewInput) => Promise<IssueView>
  /** Update an issue view: IPC persist + reload views list. */
  updateIssueViewData: (id: string, patch: UpdateIssueViewInput) => Promise<void>
  /** Delete an issue view: IPC persist + reload views list. */
  deleteIssueViewData: (id: string) => Promise<void>
  reorderIssueViews: (orderedIds: string[]) => void

  // ── Internal helpers (called by action coordinators) ──────────────
  /** Remove all issues belonging to a project. Used by deleteProject cascade. */
  removeIssuesForProject: (projectId: string) => void
  /** Clear the full issue detail cache. Used by cross-project navigation. */
  clearDetailCache: () => void
}

// ─── Memoized Selector ──────────────────────────────────────────────

/**
 * Memoized selector: derives a flat `IssueSummary[]` from the normalized store.
 *
 * Returns a referentially stable array as long as `issueById` and `issueIds`
 * haven't changed — safe for React dependency arrays and useMemo deps.
 *
 * Usage:
 *   const issues = useIssueStore(selectIssuesArray)
 */
let _memoIssueIds: string[] | null = null
let _memoIssueById: Record<string, IssueSummary> | null = null
let _memoIssuesArray: IssueSummary[] = []

export function selectIssuesArray(state: IssueStore): IssueSummary[] {
  if (state.issueIds === _memoIssueIds && state.issueById === _memoIssueById) {
    return _memoIssuesArray
  }
  _memoIssueIds = state.issueIds
  _memoIssueById = state.issueById
  _memoIssuesArray = state.issueIds.map((id) => state.issueById[id]).filter(Boolean)
  return _memoIssuesArray
}

// ─── Store Implementation ───────────────────────────────────────────

export const useIssueStore = create<IssueStore>((set, get) => ({
  // ── Issue Data ────────────────────────────────────────────────────
  issueById: {},
  issueIds: [],
  issueDetailCache: new Map(),
  childIssuesCache: {},
  customLabels: [],

  // ── Issue Views ───────────────────────────────────────────────────
  issueViews: [],
  viewIssueCounts: {},

  // ── Issue Data Operations ─────────────────────────────────────────

  loadIssues: async () => {
    const seq = ++_loadIssuesSeq
    const ownState = get()
    const appState = useAppStore.getState()

    const activeView = appState.activeViewId === ALL_VIEW.id
      ? ALL_VIEW
      : ownState.issueViews.find((v) => v.id === appState.activeViewId) ?? ALL_VIEW

    // Determine sidebar project context
    const sidebarProjectId = appState.appView.mode === 'projects'
      ? appState.appView.projectId
      : null

    const queryFilter = resolveToQuery(
      activeView.filters,
      appState.ephemeralFilters,
      {
        sidebarProjectId,
        isAllView: activeView.id === ALL_VIEW.id,
      },
    )

    // Add sort: All view uses in-memory allViewDisplay, custom views use persisted display
    const displayConfig = appState.activeViewId === ALL_VIEW.id
      ? appState.allViewDisplay
      : activeView.display
    queryFilter.sort = displayConfig.sort

    const issues = await queryIssueSummaries({ filter: queryFilter })

    // Discard stale response: a newer loadIssues call was made while this
    // one was in-flight, so its result is already outdated.
    if (seq !== _loadIssuesSeq) return

    set(normalizeIssues(issues))
    // Refresh tab counts after each issue load (fire-and-forget)
    fireAndForget(get().loadViewIssueCounts(), 'loadIssues.loadViewIssueCounts')
  },

  // Populate issues from the initial useAppBootstrap load so that
  // Issue ↔ Session links work before IssuesView mounts.
  // Only sets if the store is still empty (avoids clobbering a
  // later filtered load triggered by IssuesView).
  setIssuesFromInitialLoad: (issues) => {
    if (get().issueIds.length === 0) {
      set(normalizeIssues(issues))
    }
  },

  loadIssueDetail: (id) => {
    // De-duplicate: return the existing in-flight promise for this ID.
    const inflight = _issueDetailInflight.get(id)
    if (inflight) return inflight

    const promise = getAppAPI()['get-issue'](id).then((issue) => {
      // Cache population is independent of selection — React subscriptions
      // to `selectedIssueId` handle UI rendering.
      if (issue) {
        set((s) => {
          const next = new Map(s.issueDetailCache)
          next.set(id, issue)
          return { issueDetailCache: next }
        })
      } else {
        // Issue no longer exists (deleted externally, DB migration, etc.).
        // Evict any stale entry so consumers don't see a phantom issue.
        set((s) => {
          if (!s.issueDetailCache.has(id)) return s
          const next = new Map(s.issueDetailCache)
          next.delete(id)
          return { issueDetailCache: next }
        })
      }
      return issue ?? null
    }).finally(() => {
      _issueDetailInflight.delete(id)
    })

    _issueDetailInflight.set(id, promise)
    return promise
  },

  prefetchIssueDetail: (id) => {
    // Already cached — skip
    if (get().issueDetailCache.has(id)) return
    // Silent background fetch — no race-condition guard needed since
    // prefetch only writes to cache, never affects selection state.
    getAppAPI()['get-issue'](id).then((issue) => {
      if (issue) {
        set((s) => {
          const next = new Map(s.issueDetailCache)
          next.set(id, issue)
          return { issueDetailCache: next }
        })
      }
    }).catch(() => {
      // Prefetch is best-effort — swallow errors silently.
    })
  },

  createIssue: async (input) => {
    const issue = await getAppAPI()['create-issue'](input)
    await get().loadIssues()
    // Refresh child issues cache if this is a sub-issue
    if (input.parentIssueId) {
      fireAndForget(get().loadChildIssues(input.parentIssueId), 'createIssue.loadChildIssues')
    }
    return issue
  },

  patchIssueOptimistic: (id, patch) => {
    set((s) => {
      const existing = s.issueById[id]
      if (!existing) return {}
      // Reference equality check — skip if nothing changed
      const keys = Object.keys(patch) as (keyof IssueSummary)[]
      if (keys.every((k) => existing[k] === patch[k])) return {}

      const updated = { ...existing, ...patch }
      const result: Partial<IssueStore> = {
        issueById: { ...s.issueById, [id]: updated },
      }
      // Dual-write: also patch issueDetailCache so IssueDetailView
      // sees the update without a full loadIssueDetail round-trip.
      // Mirrors the patchReadAt() pattern.
      const cached = s.issueDetailCache.get(id)
      if (cached) {
        const nextCache = new Map(s.issueDetailCache)
        nextCache.set(id, { ...cached, ...patch })
        result.issueDetailCache = nextCache
      }
      return result
    })
  },

  updateIssue: async (id, patch) => {
    // Save old parentIssueId before update (loadIssues will overwrite normalized issues)
    const oldParentId = get().issueById[id]?.parentIssueId ?? null

    // ── Optimistic detail-cache update (stale-while-revalidate) ──────
    //
    // Merge the patch into the cached detail entry IMMEDIATELY so the UI
    // reflects the change without any null gap.  The `update-issue` IPC
    // returns the canonical Issue which overwrites this optimistic entry
    // in the same tick as the response.
    //
    // WHY NOT delete-then-reload (the old pattern):
    //   `next.delete(id)` made `issue` null in IssueDetailView's selector,
    //   which unmounted the entire ProjectScopeProvider → SessionPanel →
    //   Virtuoso tree.  The subsequent IPC took 10-20 ms to resolve,
    //   during which the "Loading…" placeholder was painted — visible as
    //   a white flash.  On remount the Virtuoso instance was brand-new
    //   (scroll position lost, memoized values cleared).
    const prevCached = get().issueDetailCache.get(id) ?? null
    set((s) => {
      const cached = s.issueDetailCache.get(id)
      if (!cached) return s
      const next = new Map(s.issueDetailCache)
      next.set(id, { ...cached, ...patch })
      return { issueDetailCache: next }
    })

    try {
      // The IPC returns the canonical Issue (including contextRefs from
      // the junction table).  Using it directly eliminates one round-trip
      // vs. a separate `loadIssueDetail(id)` call.
      const updated = await getAppAPI()['update-issue'](id, patch)
      await get().loadIssues()

      // Write canonical backend data to cache (or evict if deleted mid-update)
      set((s) => {
        const next = new Map(s.issueDetailCache)
        if (updated) {
          next.set(id, updated)
        } else {
          next.delete(id)
        }
        return { issueDetailCache: next }
      })

      // Refresh child caches when parent-child relationship changes
      if ('parentIssueId' in patch) {
        if (oldParentId) fireAndForget(get().loadChildIssues(oldParentId), 'updateIssue.loadChildIssues(old)')
        if (patch.parentIssueId) fireAndForget(get().loadChildIssues(patch.parentIssueId), 'updateIssue.loadChildIssues(new)')
      }
    } catch (error) {
      // ── Rollback optimistic write on IPC failure ──────────────────
      // Restore the previously cached entry (or remove the key entirely
      // if there was no cache entry before the optimistic write).
      set((s) => {
        const next = new Map(s.issueDetailCache)
        if (prevCached) next.set(id, prevCached)
        else next.delete(id)
        return { issueDetailCache: next }
      })
      throw error
    }
  },

  deleteIssueData: async (id) => {
    // Capture parent BEFORE deletion so we can refresh the parent's child list
    const parentId = get().issueById[id]?.parentIssueId
      ?? get().issueDetailCache.get(id)?.parentIssueId
      ?? null

    const result = await getAppAPI()['delete-issue'](id)
    if (result) {
      // Evict from detail cache + child cache
      set((s) => {
        const nextCache = new Map(s.issueDetailCache)
        nextCache.delete(id)
        const { [id]: _, ...restChildCache } = s.childIssuesCache
        return { issueDetailCache: nextCache, childIssuesCache: restChildCache }
      })
      await get().loadIssues()
      // Refresh the parent's child list so the UI removes the deleted child
      if (parentId) {
        fireAndForget(get().loadChildIssues(parentId), 'deleteIssueData.loadChildIssues')
      }
    }
    return result
  },

  loadChildIssues: async (parentId) => {
    const children = await getAppAPI()['list-child-issues'](parentId)
    set((s) => ({
      childIssuesCache: { ...s.childIssuesCache, [parentId]: children }
    }))
    return children
  },

  batchUpdateIssues: async (ids, patch) => {
    const results = await getAppAPI()['batch-update-issues'](ids, patch)
    await get().loadIssues()
    return results
  },

  markIssueRead: async (id) => {
    const updated = await getAppAPI()['mark-issue-read'](id)
    if (updated) {
      set((s) => patchReadAt(s, id, updated.readAt))
    }
  },

  markIssueUnread: async (id) => {
    const updated = await getAppAPI()['mark-issue-unread'](id)
    if (updated) {
      set((s) => patchReadAt(s, id, updated.readAt))
    }
  },

  // ── Custom Label Operations ───────────────────────────────────────

  loadCustomLabels: async () => {
    const labels = await getAppAPI()['list-custom-labels']()
    set({ customLabels: labels })
  },

  createCustomLabel: async (label) => {
    const labels = await getAppAPI()['create-custom-label'](label)
    set({ customLabels: labels })
  },

  deleteCustomLabel: async (label) => {
    const labels = await getAppAPI()['delete-custom-label'](label)
    set({ customLabels: labels })
    // Backend cascaded the deletion into issue view filters — reload
    // views so the UI reflects the cleaned-up filter configs, then
    // re-query issues in case the active view's filters changed.
    await get().loadIssueViews()
    fireAndForget(get().loadIssues(), 'deleteCustomLabel.loadIssues')
  },

  updateCustomLabel: async (oldLabel, newLabel) => {
    const labels = await getAppAPI()['update-custom-label'](oldLabel, newLabel)
    set({ customLabels: labels })
    // Backend cascaded the rename into issue view filters — reload.
    await get().loadIssueViews()
    fireAndForget(get().loadIssues(), 'updateCustomLabel.loadIssues')
  },

  // ── Issue View Operations ─────────────────────────────────────────

  loadIssueViews: async () => {
    const views = await getAppAPI()['list-issue-views']()
    set({ issueViews: views })
  },

  loadViewIssueCounts: async () => {
    const seq = ++_loadCountsSeq
    const ownState = get()
    const appState = useAppStore.getState()

    const sidebarProjectId = appState.appView.mode === 'projects'
      ? appState.appView.projectId
      : null

    // Non-active tabs: use ONLY each view's persistent filters (empty ephemeral).
    // Ephemeral filters are view-local and cleared on tab switch, so applying them
    // to other tabs would create false counts — user would see a count mismatch
    // the moment they click that tab (filter clears, more issues appear).
    //
    // Active tab: skip the DB query entirely — use issues.length which was just
    // set by loadIssues() (already reflects view.filters ∩ ephemeral).
    const activeViewId = appState.activeViewId

    // Collect only non-active views that need a base-count query
    const viewsToCount = [
      ...(activeViewId !== ALL_VIEW.id ? [{ id: ALL_VIEW.id, filters: ALL_VIEW.filters, isAllView: true as const }] : []),
      ...ownState.issueViews
        .filter((v) => v.id !== activeViewId)
        .map((v) => ({ id: v.id, filters: v.filters, isAllView: false as const })),
    ]

    const queryFilters = viewsToCount.map(({ filters, isAllView }) =>
      resolveToQuery(filters, {}, { sidebarProjectId, isAllView })
    )

    const results = await Promise.allSettled(
      queryFilters.map((f) => getAppAPI()['count-issues'](f))
    )

    // Discard stale response: a newer loadViewIssueCounts call was made while
    // these count queries were in-flight.
    if (seq !== _loadCountsSeq) return

    const counts: Record<string, number> = {}
    viewsToCount.forEach(({ id }, i) => {
      const result = results[i]
      if (result.status === 'fulfilled') {
        counts[id] = result.value
      }
      // On rejection: omit this view's count — merge below retains the previous value
    })
    // Active tab gets the live filtered count already in memory — no extra query
    counts[activeViewId] = get().issueIds.length

    // Merge into existing counts instead of full replacement.  Views whose
    // count query rejected above keep their previous value in state, and any
    // views not included in this batch (e.g. newly created while in-flight)
    // are preserved rather than silently dropped.
    set((s) => ({ viewIssueCounts: { ...s.viewIssueCounts, ...counts } }))
  },

  createIssueView: async (input) => {
    const view = await getAppAPI()['create-issue-view'](input)
    await get().loadIssueViews()
    return view
  },

  updateIssueViewData: async (id, patch) => {
    await getAppAPI()['update-issue-view'](id, patch)
    await get().loadIssueViews()
  },

  deleteIssueViewData: async (id) => {
    await getAppAPI()['delete-issue-view'](id)
    await get().loadIssueViews()
  },

  reorderIssueViews: (orderedIds) => {
    // Optimistic reorder with rollback on failure
    const prevViews = get().issueViews
    const orderedSet = new Set(orderedIds)

    // Views explicitly ordered by the caller
    const reordered = orderedIds
      .map((id) => prevViews.find((v) => v.id === id))
      .filter((v): v is IssueView => v !== undefined)

    // Preserve any views not included in orderedIds (e.g. created concurrently)
    // — append them at the end in their original relative order.
    const remainder = prevViews.filter((v) => !orderedSet.has(v.id))
    const merged = [...reordered, ...remainder].map((v, i) => ({ ...v, position: i }))

    set({ issueViews: merged })
    fireAndForget(
      getAppAPI()['reorder-issue-views'](orderedIds).catch(() => {
        // Rollback: restore previous order on IPC failure
        set({ issueViews: prevViews })
      }),
      'reorderIssueViews',
    )
  },

  // ── Internal Helpers ──────────────────────────────────────────────

  removeIssuesForProject: (projectId) => {
    set((s) => {
      // Collect IDs that belong to this project so we can evict from all caches
      const evictIds = new Set(
        s.issueIds.filter((id) => s.issueById[id]?.projectId === projectId),
      )

      // Normalised list — keep only issues NOT in this project
      const nextIssueIds = s.issueIds.filter((id) => !evictIds.has(id))
      const nextIssueById: Record<string, IssueSummary> = {}
      for (const id of nextIssueIds) nextIssueById[id] = s.issueById[id]

      // Detail cache — evict entries for this project
      const nextDetailCache = new Map(s.issueDetailCache)
      for (const id of evictIds) nextDetailCache.delete(id)

      // Child issues cache — evict entries keyed by project's issue IDs
      const nextChildCache = { ...s.childIssuesCache }
      for (const id of evictIds) delete nextChildCache[id]

      return {
        issueById: nextIssueById,
        issueIds: nextIssueIds,
        issueDetailCache: nextDetailCache,
        childIssuesCache: nextChildCache,
      }
    })
  },

  clearDetailCache: () => {
    set({ issueDetailCache: new Map() })
  },
}))
