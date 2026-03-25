// SPDX-License-Identifier: Apache-2.0

/**
 * TerminalOverlayStore — Embedded terminal panel + multi-tab state management.
 *
 * Separation of concerns:
 * - terminalOverlay: panel toggle + current scope (panel-level)
 * - terminalTabGroups: per-scope tab collection (persisted, retained after panel close)
 *
 * Does not modify the AppView type or affect projects/inbox navigation logic.
 */

import { create } from 'zustand'
import type {
  TerminalScope,
  TerminalOverlayState,
  TerminalTab,
  TerminalTabGroup,
} from '@shared/types'

// ─── Store Interface ──────────────────────────────────────────────────

export interface TerminalOverlayStore {
  /** Current open terminal panel state; null means the panel is collapsed */
  terminalOverlay: TerminalOverlayState | null

  /** Exit animation in-progress flag (two-phase exit: close -> animate -> finish) */
  _terminalExiting: boolean

  /** Per-scope terminal tab collection (scopeKey -> TabGroup) */
  terminalTabGroups: Record<string, TerminalTabGroup>

  // ── Panel Actions ──
  openTerminalOverlay: (scope: TerminalScope) => void
  closeTerminalOverlay: () => void
  /** Called after exit animation completes to actually unmount the terminal panel */
  finishTerminalExit: () => void
  switchTerminalScope: (scope: TerminalScope) => void

  // ── Tab Actions ──
  /** Idempotent tab registration (called on first ensure; skipped if already exists) */
  ensureTerminalTab: (scopeKey: string, terminalId: string, displayName: string) => void
  /** Explicitly add a new tab (called after spawn) */
  addTerminalTab: (scopeKey: string, tab: TerminalTab) => void
  /** Remove a tab (called on close / PTY exit) */
  removeTerminalTab: (scopeKey: string, terminalId: string) => void
  /** Switch the active tab within the current scope */
  setActiveTerminalTab: (scopeKey: string, terminalId: string) => void
  /** Update tab order after drag-and-drop reordering */
  reorderTerminalTabs: (scopeKey: string, orderedIds: string[]) => void

  /** Reset to initial state */
  reset: () => void
}

// ─── Initial State ────────────────────────────────────────────────────

const initialState = {
  terminalOverlay: null as TerminalOverlayState | null,
  _terminalExiting: false,
  terminalTabGroups: {} as Record<string, TerminalTabGroup>,
}

// ─── Store ────────────────────────────────────────────────────────────

export const useTerminalOverlayStore = create<TerminalOverlayStore>((set, get) => ({
  ...initialState,

  // ── Panel Actions ──

  openTerminalOverlay: (scope) => {
    set({
      terminalOverlay: { scope },
      _terminalExiting: false,
    })
  },

  closeTerminalOverlay: () => {
    const overlay = get().terminalOverlay
    if (!overlay) return
    // Phase 1: mark as exiting, trigger exit animation (panel stays mounted)
    set({ _terminalExiting: true })
  },

  finishTerminalExit: () => {
    // Phase 2: animation complete, actually unmount
    set({ terminalOverlay: null, _terminalExiting: false })
  },

  switchTerminalScope: (scope) => {
    const current = get().terminalOverlay
    if (!current) return
    set({
      terminalOverlay: { scope },
    })
  },

  // ── Tab Actions ──

  ensureTerminalTab: (scopeKey, terminalId, displayName) => {
    set((s) => {
      const group = s.terminalTabGroups[scopeKey]
      // Already exists -> idempotent skip
      if (group?.tabs.some((t) => t.terminalId === terminalId)) {
        return {}
      }
      const newTab: TerminalTab = { terminalId, displayName }
      const newGroup: TerminalTabGroup = group
        ? { tabs: [...group.tabs, newTab], activeTabId: terminalId }
        : { tabs: [newTab], activeTabId: terminalId }
      return {
        terminalTabGroups: { ...s.terminalTabGroups, [scopeKey]: newGroup },
      }
    })
  },

  addTerminalTab: (scopeKey, tab) => {
    set((s) => {
      const group = s.terminalTabGroups[scopeKey]
      const newGroup: TerminalTabGroup = group
        ? { tabs: [...group.tabs, tab], activeTabId: tab.terminalId }
        : { tabs: [tab], activeTabId: tab.terminalId }
      return {
        terminalTabGroups: { ...s.terminalTabGroups, [scopeKey]: newGroup },
      }
    })
  },

  removeTerminalTab: (scopeKey, terminalId) => {
    set((s) => {
      const group = s.terminalTabGroups[scopeKey]
      if (!group) return {}
      const newTabs = group.tabs.filter((t) => t.terminalId !== terminalId)
      if (newTabs.length === 0) {
        // All tabs closed -> remove the entire group
        const { [scopeKey]: _, ...rest } = s.terminalTabGroups
        return { terminalTabGroups: rest }
      }
      // If the active tab was removed -> auto-select the last one
      const newActiveId = group.activeTabId === terminalId
        ? newTabs[newTabs.length - 1].terminalId
        : group.activeTabId
      return {
        terminalTabGroups: {
          ...s.terminalTabGroups,
          [scopeKey]: { tabs: newTabs, activeTabId: newActiveId },
        },
      }
    })
  },

  setActiveTerminalTab: (scopeKey, terminalId) => {
    set((s) => {
      const group = s.terminalTabGroups[scopeKey]
      if (!group) return {}
      return {
        terminalTabGroups: {
          ...s.terminalTabGroups,
          [scopeKey]: { ...group, activeTabId: terminalId },
        },
      }
    })
  },

  reorderTerminalTabs: (scopeKey, orderedIds) => {
    set((s) => {
      const group = s.terminalTabGroups[scopeKey]
      if (!group) return {}
      const tabMap = new Map(group.tabs.map((t) => [t.terminalId, t]))
      const reordered = orderedIds
        .map((id) => tabMap.get(id))
        .filter(Boolean) as TerminalTab[]
      return {
        terminalTabGroups: {
          ...s.terminalTabGroups,
          [scopeKey]: { ...group, tabs: reordered },
        },
      }
    })
  },

  reset: () => set(initialState),
}))
