// SPDX-License-Identifier: Apache-2.0

/**
 * issueActions — Cross-store coordination for issue operations.
 *
 * Action coordinators that write to both issueStore (data) and appStore
 * (navigation / per-project state).
 *
 * Exported functions:
 *   - selectIssue / deleteIssue — issue lifecycle
 *   - setActiveView / setEphemeralFilters — view state + issue reload
 *   - updateIssueView / deleteIssueView — view mutation + cleanup
 *
 * Functions are plain exports (not store methods) — consumers call
 * them directly:
 *
 *   import { selectIssue, setActiveView } from '@/actions/issueActions'
 */

import type { DetailContext, EphemeralFilters, UpdateIssueViewInput } from '@shared/types'
import { ALL_VIEW } from '@shared/types'
import { useIssueStore } from '@/stores/issueStore'
import { useAppStore } from '@/stores/appStore'
import type { ProjectViewState } from '@/stores/appStore'
import { fireAndForget } from '@/lib/asyncUtils'

// ─── Issue Selection ────────────────────────────────────────────────

/**
 * Select an issue: updates appStore navigation state (selectedIssueId,
 * detailContext, _tabDetails) and triggers issueStore data load.
 *
 * `selectedIssueId` lives in appStore (not issueStore) because it
 * participates in the per-project `_projectStates` save/restore cycle.
 */
export function selectIssue(id: string | null): void {
  const ctx: DetailContext | null = id ? { type: 'issue', issueId: id } : null
  useAppStore.setState((s) => ({
    selectedIssueId: id,
    detailContext: ctx,
    // Always route to the issues tab — selectIssue can be called
    // cross-tab (e.g. from SessionDetailView's linked issue button).
    _tabDetails: { ...s._tabDetails, issues: ctx }
  }))
  // Load (or refresh) full issue data for the detail view.
  // If cached, the component renders instantly; this call refreshes in background.
  if (id) {
    fireAndForget(useIssueStore.getState().loadIssueDetail(id), 'selectIssue.loadIssueDetail')
  }
}

// ─── Issue Deletion ─────────────────────────────────────────────────

/**
 * Delete an issue: coordinates appStore navigation cleanup with issueStore
 * data eviction.
 *
 * ORDER MATTERS: clear selection BEFORE evicting data.  `deleteIssueData`
 * removes the entry from `issueDetailCache` and reloads the normalised list.
 * If the deleted issue is still selected at that moment, React components
 * subscribed to `selectedIssueId` will dereference a now-missing cache entry,
 * producing a brief "Loading…" flash before the subsequent selection clear
 * triggers another re-render.  By clearing selection first, the UI transitions
 * away from the deleted issue in a single consistent frame.
 */
export async function deleteIssue(id: string): Promise<boolean> {
  // Clear selection BEFORE data eviction to prevent flash
  const wasSelected = useAppStore.getState().selectedIssueId === id
  if (wasSelected) {
    useAppStore.setState((s) => ({
      selectedIssueId: null,
      detailContext: null,
      _tabDetails: { ...s._tabDetails, issues: null }
    }))
  }
  return useIssueStore.getState().deleteIssueData(id)
}

// ─── View State Coordination ────────────────────────────────────────

/**
 * Set the active issue view: updates appStore per-project state
 * (activeViewId, clears ephemeralFilters) then reloads issues.
 *
 * Consumers should call this instead of `useAppStore.getState().setActiveView`
 * to ensure the issue list stays in sync with the view switch.
 */
export function setActiveView(viewId: string): void {
  useAppStore.setState({ activeViewId: viewId, ephemeralFilters: {} })
  fireAndForget(useIssueStore.getState().loadIssues(), 'setActiveView.loadIssues')
}

/**
 * Set ephemeral (transient) issue filters: updates appStore per-project state
 * then reloads issues with the new filter combination.
 *
 * Consumers should call this instead of `useAppStore.getState().setEphemeralFilters`
 * to ensure the issue list stays in sync with the filter change.
 */
export function setEphemeralFilters(filters: EphemeralFilters): void {
  useAppStore.setState({ ephemeralFilters: filters })
  fireAndForget(useIssueStore.getState().loadIssues(), 'setEphemeralFilters.loadIssues')
}

// ─── Issue View Mutation ────────────────────────────────────────────

/**
 * Update an issue view: delegates IPC to issueStore, then reloads issues
 * if the updated view is currently active.
 */
export async function updateIssueView(id: string, patch: UpdateIssueViewInput): Promise<void> {
  await useIssueStore.getState().updateIssueViewData(id, patch)
  // If the updated view is active, reload issues with new filters.
  // loadIssues reads appStore.activeViewId — must run after the synchronous
  // setState in updateIssueViewData has already flushed.
  if (useAppStore.getState().activeViewId === id) {
    fireAndForget(useIssueStore.getState().loadIssues(), 'updateIssueView.loadIssues')
  }
}

/**
 * Delete an issue view: delegates IPC to issueStore, then coordinates
 * appStore _projectStates cleanup + reload.
 *
 * Touches _projectStates because non-active projects may have this view
 * saved as their `activeViewId` — without cleanup, returning to such a
 * project would briefly show a stale view selection.
 */
export async function deleteIssueView(id: string): Promise<void> {
  await useIssueStore.getState().deleteIssueViewData(id)

  // If deleted view was active, switch to All + clean up stale project refs.
  // Single setState call to avoid intermediate render with inconsistent state.
  useAppStore.setState((s) => {
    const resetActive = s.activeViewId === id
      ? { activeViewId: ALL_VIEW.id, ephemeralFilters: {} satisfies EphemeralFilters }
      : {}

    // Clean up any non-active project states that reference the deleted view.
    // Without this, returning to a project that had this view selected would
    // briefly restore a stale activeViewId (loadIssues falls back gracefully
    // via ?? ALL_VIEW, but the sidebar highlight would be wrong).
    //
    // Lazy allocation: only clone _projectStates when a match is found.
    let cleaned: Record<string, ProjectViewState> | null = null
    for (const [key, state] of Object.entries(s._projectStates)) {
      if (state.activeViewId === id) {
        if (!cleaned) cleaned = { ...s._projectStates }
        cleaned[key] = { ...state, activeViewId: ALL_VIEW.id, ephemeralFilters: {} }
      }
    }

    return {
      ...resetActive,
      ...(cleaned ? { _projectStates: cleaned } : {}),
    }
  })

  // loadIssues reads appStore.activeViewId — must run after the synchronous
  // setState above so it sees the updated view (ALL_VIEW if active was deleted).
  fireAndForget(useIssueStore.getState().loadIssues(), 'deleteIssueView.loadIssues')
}
