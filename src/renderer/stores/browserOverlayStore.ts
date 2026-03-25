// SPDX-License-Identifier: Apache-2.0

/**
 * BrowserOverlayStore — Standalone Zustand store for browser overlay state management.
 *
 * Manages the full lifecycle state of the fullscreen browser overlay.
 * Does not modify the AppView type or affect projects/inbox navigation logic.
 *
 * Page info (URL/title/isLoading) is stored in viewPageInfoMap (keyed by viewId),
 * serving as the single source of truth for all consumers (BrowserSheet, PiP Panel).
 * browserOverlay.pageInfo is automatically synced by updateViewPageInfo.
 *
 * ## Session State Architecture
 *
 * Agent session data (state, activity, error, messages) is canonical in `commandStore`.
 * This store only holds `agentSessionId` (session identity) and `agentState` (optimistic
 * hint during the brief window before the session is registered in `commandStore`).
 *
 * Consumers read session data from `commandStore.sessionById[agentSessionId]`, falling
 * back to overlay's `agentState` only when the session doesn't yet exist in `commandStore`.
 */

import { create } from 'zustand'
import type {
  BrowserSource,
  BrowserOpenOptions,
  BrowserOverlayState,
  ActiveBrowserSource,
  BrowserExecutorState,
  BrowserPageInfoPayload,
  BrowserProfileInfo,
  ManagedSessionState,
} from '@shared/types'
import { getAppAPI } from '@/windowAPI'

// ─── Source Key Derivation ────────────────────────────────────────────────
// Deterministic key from BrowserSource discriminated union — used to persist
// agentSessionId across overlay close/reopen (PiP minimize/restore cycle).

export function deriveSourceKey(source: BrowserSource): string {
  switch (source.type) {
    case 'standalone':
      return 'standalone'
    case 'issue-standalone':
      return `issue-standalone:${source.issueId}`
    case 'chat-session':
      return `chat-session:${source.sessionId}`
    case 'issue-session':
      return `issue-session:${source.sessionId}`
  }
}

// ─── Store Interface ────────────────────────────────────────────────────

export interface BrowserOverlayStore {
  /** Currently open browser overlay; null means closed */
  browserOverlay: BrowserOverlayState | null

  /** All sources with active views (data source for the Source Switcher dropdown) */
  activeBrowserSources: ActiveBrowserSource[]

  /**
   * Centralized page info store (single source of truth).
   *
   * key = viewId, value = page info.
   * All consumers (BrowserSheet, PiP Panel, Source Switcher) read from here.
   * The browser:navigated event only needs to call updateViewPageInfo, which
   * automatically syncs to browserOverlay.pageInfo (if the viewId matches).
   */
  viewPageInfoMap: Record<string, BrowserPageInfoPayload>

  /**
   * Persisted agentSessionId per BrowserSource.
   *
   * Survives the overlay lifecycle (close → reopen) so the user's
   * conversation is restored after PiP minimize/restore.
   * Key = deriveSourceKey(source), Value = agentSessionId.
   */
  _sourceSessionMap: Record<string, string>

  /** Internal: exit animation flag (BrowserSheet detects this to trigger slide-out animation) */
  _browserSheetExiting: boolean

  // ── Actions ──
  openBrowserOverlay: (source: BrowserSource, options?: BrowserOpenOptions) => void
  closeBrowserOverlay: () => void
  /** Clear overlay state after animation completes (called by BrowserSheet onAnimationEnd callback) */
  finishBrowserSheetExit: () => void
  switchBrowserSource: (source: BrowserSource) => void

  // ── Overlay state updaters (for DataBus event handlers) ──
  setBrowserOverlayViewId: (viewId: string | null) => void
  setBrowserOverlayExecutorState: (state: BrowserExecutorState) => void
  setBrowserOverlayIsLoading: (isLoading: boolean) => void
  setBrowserOverlayUrlBarValue: (value: string) => void
  setBrowserOverlayUrlBarFocused: (focused: boolean) => void
  setBrowserOverlayActiveProfileId: (id: string | null) => void
  setBrowserOverlayProfiles: (profiles: BrowserProfileInfo[]) => void
  setBrowserOverlayAgentSessionId: (id: string | null) => void
  /** Set optimistic agent state — only used during session creation before commandStore has the session. */
  setBrowserOverlayAgentState: (state: ManagedSessionState | null) => void
  /** Reset agent session identity and optimistic state (clears chat). */
  resetBrowserOverlayAgentSession: () => void
  setBrowserOverlayChatInput: (input: string) => void
  setBrowserOverlayIsChatSending: (sending: boolean) => void
  setBrowserOverlayCurrentAction: (action: string | null) => void
  setBrowserOverlayChatPanelCollapsed: (collapsed: boolean) => void

  // ── Page info (single source of truth) ──

  /**
   * Update page info for a view. Merges with existing entry.
   * Automatically syncs to browserOverlay.pageInfo + urlBar when the viewId
   * matches the currently displayed overlay.
   */
  updateViewPageInfo: (viewId: string, info: Partial<BrowserPageInfoPayload>) => void
  /** Remove page info entry when a view is closed. */
  removeViewPageInfo: (viewId: string) => void

  // ── Active browser sources ──

  /** Update activeBrowserSources list */
  setActiveBrowserSources: (sources: ActiveBrowserSource[]) => void
  addActiveBrowserSource: (source: ActiveBrowserSource) => void
  removeActiveBrowserSource: (viewId: string) => void

  // ── Session persistence (PiP restore) ──

  /** Save agentSessionId for a source (called on overlay close) */
  _saveSourceSession: (source: BrowserSource, sessionId: string) => void
  /** Restore agentSessionId for a source (called on overlay reopen). Returns null if none. */
  _restoreSourceSession: (source: BrowserSource) => string | null
  /** Remove a session from _sourceSessionMap by sessionId (called on session delete) */
  removeSourceSession: (sessionId: string) => void

  // ── Overlay Blockers (generic native-view hide mechanism) ──

  /**
   * Set of active blocker IDs. When non-empty, the WebContentsView is hidden
   * so that DOM-layer modals (Artifact viewer, CommandPalette, Settings, etc.)
   * are not obscured by the native layer.
   *
   * Any component can register/unregister a blocker via addOverlayBlocker / removeOverlayBlocker.
   */
  overlayBlockers: Set<string>
  addOverlayBlocker: (id: string) => void
  removeOverlayBlocker: (id: string) => void

  /** Reset store to initial state */
  reset: () => void
}

// ─── Default state ───────────────────────────────────────────────────────

const DEFAULT_CHAT_PANEL_WIDTH = 30

const initialState = {
  browserOverlay: null as BrowserOverlayState | null,
  activeBrowserSources: [] as ActiveBrowserSource[],
  viewPageInfoMap: {} as Record<string, BrowserPageInfoPayload>,
  _sourceSessionMap: {} as Record<string, string>,
  _browserSheetExiting: false,
  overlayBlockers: new Set<string>(),
}

// ─── Store ───────────────────────────────────────────────────────────────

export const useBrowserOverlayStore = create<BrowserOverlayStore>((set, get) => {
  /** Helper: update a field inside browserOverlay (no-op if overlay is null) */
  function updateOverlay(
    updater: (overlay: BrowserOverlayState) => Partial<BrowserOverlayState>,
  ): void {
    set((s) => {
      if (!s.browserOverlay) return {}
      return {
        browserOverlay: { ...s.browserOverlay, ...updater(s.browserOverlay) },
      }
    })
  }

  return {
    ...initialState,

    openBrowserOverlay: (source, options) => {
      // Restore persisted session from a previous PiP close/reopen cycle
      const restoredSessionId = get()._restoreSourceSession(source)

      set({
        browserOverlay: {
          source,
          viewId: null,
          executorState: 'idle',
          pageInfo: null,
          isLoading: false,
          profiles: [],
          activeProfileId: options?.profileId ?? null,
          urlBarValue: options?.initialUrl ?? '',
          urlBarFocused: false,
          agentSessionId: restoredSessionId,
          agentState: restoredSessionId ? 'idle' : null,
          chatInput: '',
          isChatSending: false,
          currentAction: null,
          chatPanelWidth: DEFAULT_CHAT_PANEL_WIDTH,
          chatPanelCollapsed: false,
        },
        _browserSheetExiting: false,
      })
    },

    closeBrowserOverlay: () => {
      const overlay = get().browserOverlay
      if (!overlay) return

      // Phase 1: Instantly hide WebContentsView (prevent native layer artifacts during exit animation)
      if (overlay.viewId) {
        getAppAPI()['browser:set-view-visible']({
          viewId: overlay.viewId,
          visible: false,
        })
      }

      // Phase 2: Trigger exit animation
      set({ _browserSheetExiting: true })
    },

    finishBrowserSheetExit: () => {
      const overlay = get().browserOverlay
      if (!overlay) return

      // Two exit paths share this function:
      //   Minimize (PiP): viewId is still set → save session + detach view (keep alive)
      //   Destroy (X close): viewId was cleared to null by browser:view:closed handler
      //                      → skip save (user explicitly destroyed) + skip detach (already destroyed)
      if (overlay.viewId) {
        if (overlay.agentSessionId) {
          get()._saveSourceSession(overlay.source, overlay.agentSessionId)
        }
        getAppAPI()['browser:detach-view'](overlay.viewId)
      }

      set({
        browserOverlay: null,
        _browserSheetExiting: false,
      })
    },

    switchBrowserSource: (source) => {
      const current = get().browserOverlay
      if (!current) return

      // Notify main process to switch the displayed view
      getAppAPI()['browser:display-source']({ source })

      // Update the source in overlay state — reset session identity
      set({
        browserOverlay: {
          ...current,
          source,
          viewId: null,
          urlBarValue: '',
          pageInfo: null,
          isLoading: true,
          agentSessionId: null,
          agentState: null,
        },
      })
    },

    // ── Field-level updaters ──

    setBrowserOverlayViewId: (viewId) => updateOverlay(() => ({ viewId })),
    setBrowserOverlayExecutorState: (state) => updateOverlay(() => ({ executorState: state })),
    setBrowserOverlayIsLoading: (isLoading) => updateOverlay(() => ({ isLoading })),
    setBrowserOverlayUrlBarValue: (value) => updateOverlay(() => ({ urlBarValue: value })),
    setBrowserOverlayUrlBarFocused: (focused) => updateOverlay(() => ({ urlBarFocused: focused })),
    setBrowserOverlayActiveProfileId: (id) => updateOverlay(() => ({ activeProfileId: id })),
    setBrowserOverlayProfiles: (profiles) => updateOverlay(() => ({ profiles })),
    setBrowserOverlayAgentSessionId: (id) => updateOverlay(() => ({ agentSessionId: id })),
    setBrowserOverlayAgentState: (state) => updateOverlay(() => ({ agentState: state })),

    resetBrowserOverlayAgentSession: () =>
      updateOverlay(() => ({
        agentSessionId: null,
        agentState: null,
      })),

    setBrowserOverlayChatInput: (input) => updateOverlay(() => ({ chatInput: input })),
    setBrowserOverlayIsChatSending: (sending) => updateOverlay(() => ({ isChatSending: sending })),
    setBrowserOverlayCurrentAction: (action) => updateOverlay(() => ({ currentAction: action })),
    setBrowserOverlayChatPanelCollapsed: (collapsed) => updateOverlay(() => ({ chatPanelCollapsed: collapsed })),

    // ── Page info (single source of truth) ──

    updateViewPageInfo: (viewId, info) =>
      set((s) => {
        // Merge with existing entry (preserve fields not in `info`)
        const existing = s.viewPageInfoMap[viewId]
        const merged: BrowserPageInfoPayload = existing
          ? { ...existing, ...info }
          : { url: '', title: '', isLoading: false, ...info }

        const updates: Partial<BrowserOverlayStore> = {
          viewPageInfoMap: { ...s.viewPageInfoMap, [viewId]: merged },
        }

        // Auto-sync to browserOverlay.pageInfo when the viewId matches
        if (s.browserOverlay?.viewId === viewId) {
          updates.browserOverlay = {
            ...s.browserOverlay,
            pageInfo: merged,
            // Only update URL bar if user isn't actively editing it
            ...(s.browserOverlay.urlBarFocused ? {} : { urlBarValue: merged.url }),
          }
        }

        return updates
      }),

    removeViewPageInfo: (viewId) =>
      set((s) => {
        const { [viewId]: _, ...rest } = s.viewPageInfoMap
        return { viewPageInfoMap: rest }
      }),

    // ── Active browser sources ──

    setActiveBrowserSources: (sources) => set({ activeBrowserSources: sources }),

    addActiveBrowserSource: (source) =>
      set((s) => ({
        activeBrowserSources: [
          ...s.activeBrowserSources.filter((as) => as.viewId !== source.viewId),
          source,
        ],
      })),

    removeActiveBrowserSource: (viewId) =>
      set((s) => ({
        activeBrowserSources: s.activeBrowserSources.filter((as) => as.viewId !== viewId),
      })),

    // ── Session persistence (PiP restore) ──

    _saveSourceSession: (source, sessionId) => {
      const key = deriveSourceKey(source)
      set((s) => ({
        _sourceSessionMap: { ...s._sourceSessionMap, [key]: sessionId },
      }))
    },

    _restoreSourceSession: (source) => {
      const key = deriveSourceKey(source)
      return get()._sourceSessionMap[key] ?? null
    },

    removeSourceSession: (sessionId) => {
      set((s) => {
        const next = { ...s._sourceSessionMap }
        let changed = false
        for (const [key, value] of Object.entries(next)) {
          if (value === sessionId) {
            delete next[key]
            changed = true
          }
        }
        return changed ? { _sourceSessionMap: next } : {}
      })
    },

    // ── Overlay Blockers ──

    addOverlayBlocker: (id) =>
      set((s) => {
        if (s.overlayBlockers.has(id)) return {}
        const next = new Set(s.overlayBlockers)
        next.add(id)
        return { overlayBlockers: next }
      }),

    removeOverlayBlocker: (id) =>
      set((s) => {
        if (!s.overlayBlockers.has(id)) return {}
        const next = new Set(s.overlayBlockers)
        next.delete(id)
        return { overlayBlockers: next }
      }),

    reset: () => set({ ...initialState, overlayBlockers: new Set() }),
  }
})
