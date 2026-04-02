// SPDX-License-Identifier: Apache-2.0

/**
 * appStore — Core application state: navigation, projects, and per-project UI.
 *
 * Manages the tightly-coupled state machine that powers the application's
 * navigation model.  The remaining slices share a per-project save/restore
 * mechanism via `_projectStates`, `_tabDetails`, and `appView` — every
 * navigation action atomically reads and writes across these slices.
 *
 * Issue domain data (CRUD, caching, labels, views list) has been extracted
 * to `issueStore`.  Per-project issue/view state (`selectedIssueId`,
 * `activeViewId`, `ephemeralFilters`, `allViewDisplay`) remains here because
 * it participates in the atomic `_projectStates` save/restore cycle.
 *
 * Independent domain concerns have been extracted into standalone stores:
 *   commandStore, issueStore, settingsStore, fileStore, scheduleStore,
 *   browserOverlayStore, terminalOverlayStore, gitStore, statsStore,
 *   tasksStore, contentSearchStore, artifactsStore, noteStore, inboxStore,
 *   messagingStore.
 *
 * Populated by:
 *   - bootstrapCoordinator (projects, sessions, onboarding, runtimeVersions)
 *   - DataBus events in useAppBootstrap (sessions:updated, etc.)
 *   - User interactions (navigation, project CRUD, view selection)
 */

import { create } from 'zustand'
import type {
  Project,
  Session,
  SessionDetail,
  StatusFilter,
  SessionsViewMode,
  ProjectTab,
  MainTab,
  ChatSubTab,
  ChatViewMode,
  FilesDisplayMode,
  AppView,
  OnboardingState,
  DetailContext,
  ViewDisplayConfig,
  EphemeralFilters,
  RuntimeVersions,
  ProjectPreferences,
} from '@shared/types'
import { ALL_VIEW } from '@shared/types'
import { normalizeProjectPreferences } from '@shared/projectPreferences'
import { getAppAPI } from '@/windowAPI'
// Circular dependency note: appStore → issueStore for navigation side-effects
// (clearDetailCache, loadIssueDetail, removeIssuesForProject, issueById read).
// issueStore → appStore for cross-store reads (activeViewId, selectedIssueId, etc.).
// ESM live bindings handle this correctly — neither store accesses the other at
// module evaluation time, so by the time any method runs both are fully initialised.
//
// Cross-store coordination (setActiveView, setEphemeralFilters, deleteIssueView,
// etc.) has been extracted to '@/actions/issueActions' — only navigation
// side-effects remain as direct imports.
import { useIssueStore } from './issueStore'
import { fireAndForget } from '@/lib/asyncUtils'

// ─── Project Memory Key ──────────────────────────────────────────────

/** Sentinel key for "All Projects" (projectId === null). */
const ALL_PROJECTS_KEY = '__all_projects__'

/**
 * Produce a safe, non-null key for `_projectStates` and related maps.
 * "All Projects" (null) maps to a sentinel; real project IDs pass through.
 */
function projectMemoryKey(projectId: string | null): string {
  return projectId ?? ALL_PROJECTS_KEY
}

// ─── Per-Project View State ──────────────────────────────────────────

/**
 * Snapshot of a project's UI state that is saved when leaving a project
 * and restored when returning. All per-project navigation state lives
 * here — no parallel maps.
 */
export interface ProjectViewState {
  // ── Navigation ────────────────────────────────────────────────────
  /** Last active tab (restored on return). */
  lastTab: MainTab
  /** Per-slot detail panel state (source of truth when not active). */
  tabDetails: Record<DetailSlotKey, DetailContext | null>
  /** Selected issue ID (keeps list highlighting in sync on restore). */
  selectedIssueId: string | null

  // ── Issues tab ────────────────────────────────────────────────────
  /** Active custom view / "All" view on the Issues tab. */
  activeViewId: string
  /** Transient filter state applied on top of the active view. */
  ephemeralFilters: EphemeralFilters
  /** In-memory display config for the All view (sort/groupBy). */
  allViewDisplay: ViewDisplayConfig

  // ── Chat tab ──────────────────────────────────────────────────────
  /** Active Chat sub-tab (conversation vs sessions) — project-scoped. */
  chatSubTab: ChatSubTab
  /** Selected chat session ID — project-scoped so each project remembers its open conversation. */
  agentChatSessionId: string | null
  /** Chat view mode (default vs files+chat split) — project-scoped. */
  chatViewMode: ChatViewMode

  // ── Sessions tab ──────────────────────────────────────────────────
  /** Session status filter (all / running / completed / etc). */
  statusFilter: StatusFilter
  /** Session search keyword. */
  searchQuery: string
  /** Sessions list/grid display mode. */
  sessionsViewMode: SessionsViewMode
}

// ─── Per-Tab Detail State ────────────────────────────────────────────

/**
 * A detail slot key identifies a specific location in the UI that can
 * hold a DetailContext. Most top-level tabs have a single slot, but the
 * Chat tab has sub-tab slots (conversation & sessions) to avoid state
 * collision when switching between them.
 */
export type DetailSlotKey = 'dashboard' | 'issues' | 'chat.conversation' | 'chat.sessions' | 'capabilities' | 'schedule' | 'starred' | 'memories'

/** All detail slots initialised to null. Frozen to prevent accidental mutation of the shared baseline. */
export const EMPTY_TAB_DETAILS = Object.freeze<Record<DetailSlotKey, DetailContext | null>>({
  dashboard: null,
  issues: null,
  'chat.conversation': null,
  'chat.sessions': null,
  capabilities: null,
  schedule: null,
  starred: null,
  memories: null,
})

/**
 * Determine which detail slot a DetailContext belongs to.
 * This allows writers like selectIssue (which can be called from any tab)
 * to always route the context to its owning slot.
 */
function resolveSlotForContext(ctx: DetailContext): DetailSlotKey {
  switch (ctx.type) {
    case 'session':
      return 'chat.sessions'
    case 'issue':
      return 'issues'
    case 'capability':
    case 'capability-edit':
    case 'capability-create':
      return 'capabilities'
    case 'schedule':
      return 'schedule'
    case 'pipeline':
      return 'schedule'
    case 'memory':
      return 'memories'
    default: {
      const _exhaustive: never = ctx
      throw new Error(`Unhandled DetailContext type: ${(_exhaustive as DetailContext).type}`)
    }
  }
}

/**
 * Get the active detail slot key for a given main tab.
 * For the Chat tab this depends on the active sub-tab.
 *
 * Exhaustive switch ensures a compile error if MainTab or ChatSubTab
 * gains a new variant that doesn't map to an existing DetailSlotKey.
 */
function activeSlotForTab(tab: MainTab, chatSubTab: ChatSubTab): DetailSlotKey {
  switch (tab) {
    case 'dashboard':    return 'dashboard'
    case 'issues':       return 'issues'
    case 'chat':
      switch (chatSubTab) {
        case 'conversation': return 'chat.conversation'
        case 'sessions':     return 'chat.sessions'
        default: {
          const _exhaustive: never = chatSubTab
          throw new Error(`Unhandled ChatSubTab: ${_exhaustive}`)
        }
      }
    case 'starred':      return 'starred'
    case 'capabilities': return 'capabilities'
    case 'schedule':     return 'schedule'
    case 'memories':     return 'memories'
    default: {
      const _exhaustive: never = tab
      throw new Error(`Unhandled MainTab: ${_exhaustive}`)
    }
  }
}

/** Fresh state for a project that has never been visited. Returns a new object each call to prevent shared-reference mutation. */
function defaultProjectState(): ProjectViewState {
  return {
    // Navigation
    lastTab: 'issues',
    tabDetails: { ...EMPTY_TAB_DETAILS },
    selectedIssueId: null,
    // Issues tab
    activeViewId: ALL_VIEW.id,
    ephemeralFilters: {},
    allViewDisplay: { ...ALL_VIEW.display },
    // Chat tab
    chatSubTab: 'conversation',
    agentChatSessionId: null,
    chatViewMode: 'default',
    // Sessions tab
    statusFilter: 'all',
    searchQuery: '',
    sessionsViewMode: 'list',
  }
}

// ─── Per-Project State Helpers (Pure Functions) ──────────────────────
//
// These four functions form the complete save/restore contract for
// per-project UI state.  When adding a new project-scoped field:
//
//   1.  Add it to `ProjectViewState`
//   2.  Set its default in `defaultProjectState()`
//   3.  Read from live store in `captureProjectSnapshot()`
//   4.  Write to live store in `projectStateToStore()`
//
// That's it — all transition paths (navigateToProject, navigateToSession,
// setMainTab, setChatSubTab, navigateToInbox) delegate to these helpers,
// so no additional changes are needed.
// ─────────────────────────────────────────────────────────────────

/**
 * Look up a project's saved view state (or fresh defaults).
 */
function getProjectState(
  states: Record<string, ProjectViewState>,
  projectId: string | null,
): ProjectViewState {
  return states[projectMemoryKey(projectId)] ?? defaultProjectState()
}

// ── Snapshot direction: live store → ProjectViewState ──────────

/** Store fields that contribute to per-project state (used by capture helpers). */
type ProjectScopedStore = Pick<AppStore,
  | 'appView' | '_tabDetails'
  | 'selectedIssueId'
  | 'activeViewId' | 'ephemeralFilters' | 'allViewDisplay'
  | 'chatSubTab' | 'agentChatSessionId' | 'chatViewMode'
  | 'statusFilter' | 'searchQuery' | 'sessionsViewMode'
>

/**
 * Build a `ProjectViewState` snapshot from the live store.
 *
 * @param overrides  Partial overrides applied on top (e.g. `setMainTab`
 *                   overriding `lastTab` with the newly selected tab).
 */
function captureProjectSnapshot(
  s: ProjectScopedStore,
  overrides?: Partial<ProjectViewState>,
): ProjectViewState {
  const currentTab = s.appView.mode === 'projects' ? s.appView.tab : 'issues'
  return {
    // Navigation
    lastTab: currentTab,
    tabDetails: { ...s._tabDetails },
    selectedIssueId: s.selectedIssueId,
    // Issues tab
    activeViewId: s.activeViewId,
    ephemeralFilters: { ...s.ephemeralFilters },
    allViewDisplay: { ...s.allViewDisplay },
    // Chat tab
    chatSubTab: s.chatSubTab,
    agentChatSessionId: s.agentChatSessionId,
    chatViewMode: s.chatViewMode,
    // Sessions tab
    statusFilter: s.statusFilter,
    searchQuery: s.searchQuery,
    sessionsViewMode: s.sessionsViewMode,
    // Caller overrides (e.g. setMainTab forcing lastTab to the new tab)
    ...overrides,
  }
}

/**
 * Capture the active project's view state into the per-project map.
 * Convenience wrapper around `captureProjectSnapshot`.
 */
function saveCurrentProjectState(
  s: ProjectScopedStore & Pick<AppStore, '_projectStates'>,
): Record<string, ProjectViewState> {
  if (s.appView.mode !== 'projects') return s._projectStates
  const key = projectMemoryKey(s.appView.projectId)
  return {
    ...s._projectStates,
    [key]: captureProjectSnapshot(s),
  }
}

// ── Restore direction: ProjectViewState → live store fields ───

/**
 * Convert a saved `ProjectViewState` into store fields suitable for
 * spreading into a `set()` return.
 *
 * Does NOT include transition-specific fields (appView, detailContext,
 * selectedSessionDetail) — callers handle those with their own logic.
 */
function projectStateToStore(target: ProjectViewState): Partial<AppStore> {
  return {
    // Navigation
    _tabDetails: { ...target.tabDetails },
    selectedIssueId: target.selectedIssueId,
    // Issues tab
    activeViewId: target.activeViewId,
    ephemeralFilters: { ...target.ephemeralFilters },
    allViewDisplay: { ...target.allViewDisplay },
    // Chat tab
    chatSubTab: target.chatSubTab,
    agentChatSessionId: target.agentChatSessionId,
    chatViewMode: target.chatViewMode,
    // Sessions tab
    statusFilter: target.statusFilter,
    searchQuery: target.searchQuery,
    sessionsViewMode: target.sessionsViewMode,
  }
}

function resolveFirstVisitProjectState(
  project: Project | null,
  currentTab: MainTab,
): Pick<ProjectViewState, 'lastTab' | 'chatViewMode'> & { filesDisplayMode: FilesDisplayMode | null } {
  if (!project) {
    return { lastTab: currentTab, chatViewMode: 'default', filesDisplayMode: null }
  }
  const preferences = normalizeProjectPreferences(project.preferences)
  return {
    lastTab: preferences.defaultTab,
    chatViewMode: preferences.defaultChatViewMode,
    filesDisplayMode: preferences.defaultFilesDisplayMode,
  }
}

/**
 * Cross-project navigation side-effect: clear the issue detail cache
 * so that stale data from the previous project is never rendered.
 *
 * Called after every navigation `set()` completes — extracted to avoid
 * duplicating the same if-guard across all four navigate* methods.
 */
function onCrossProjectTransition(isCrossProject: boolean): void {
  if (isCrossProject) {
    useIssueStore.getState().clearDetailCache()
  }
}

// ─── Slice Interfaces ────────────────────────────────────────────────

interface SessionsSlice {
  projects: Project[]
  sessions: Session[]
  /** Currently active detail — always equals _tabDetails[currentTab]. */
  detailContext: DetailContext | null
  selectedSessionDetail: SessionDetail | null
  /** Per-slot detail state (source of truth). */
  _tabDetails: Record<DetailSlotKey, DetailContext | null>
  statusFilter: StatusFilter
  setProjects: (projects: Project[]) => void
  updateProjectById: (projectId: string, updater: (project: Project) => Project) => void
  setSessions: (sessions: Session[]) => void
  selectSession: (sessionId: string | null, highlightTurnIndex?: number) => void
  openDetail: (ctx: DetailContext) => void
  closeDetail: () => void
  setSessionDetail: (detail: SessionDetail | null) => void
  setStatusFilter: (filter: StatusFilter) => void
}

interface NavigationSlice {
  appView: AppView
  navigateToProject: (projectId: string | null) => void
  navigateToSession: (projectId: string, sessionId: string) => void
  navigateToChatSession: (projectId: string, sessionId: string) => void
  navigateToIssue: (projectId: string, issueId: string) => void
  navigateToInbox: (selectedMessageId?: string | null) => void
  setMainTab: (tab: MainTab) => void
}

interface UISlice {
  searchQuery: string
  commandPaletteOpen: boolean
  aboutDialogOpen: boolean
  /** Runtime versions (Electron, Chrome, Node) — populated from initial state. */
  runtimeVersions: RuntimeVersions | null
  onboarding: OnboardingState
  showArchived: boolean
  /** Left Sidebar expanded/collapsed — controls icon-only navigation mode. */
  leftSidebarExpanded: boolean
  setLeftSidebarExpanded: (expanded: boolean) => void
  sessionsViewMode: SessionsViewMode
  chatSubTab: ChatSubTab
  /** Active chat session ID for Agent Chat — persisted across tab switches. */
  agentChatSessionId: string | null
  /** Chat view mode inside Chat tab: default conversation vs files+chat split. */
  chatViewMode: ChatViewMode
  /**
   * Per-project view state snapshots — saved when leaving a project,
   * restored when returning. Single structured map replaces N parallel
   * dictionaries for high cohesion and zero-risk extensibility.
   */
  _projectStates: Record<string, ProjectViewState>
  /** Per-project files display mode (auto-detected or user-overridden). */
  filesDisplayModeByProject: Record<string, FilesDisplayMode>
  /** AgentSidebar expanded/collapsed — persisted across tab switches. */
  agentSidebarExpanded: boolean
  setAgentSidebarExpanded: (expanded: boolean) => void
  setSearchQuery: (query: string) => void
  setCommandPaletteOpen: (open: boolean) => void
  openAboutDialog: () => void
  closeAboutDialog: () => void
  setRuntimeVersions: (versions: RuntimeVersions) => void
  setSessionsViewMode: (mode: SessionsViewMode) => void
  setChatSubTab: (tab: ChatSubTab) => void
  setAgentChatSessionId: (sessionId: string | null) => void
  setChatViewMode: (mode: ChatViewMode) => void
  setFilesDisplayMode: (projectId: string, mode: FilesDisplayMode) => void
  setOnboarding: (state: OnboardingState) => void
  addProject: () => Promise<void>
  createNewProject: (input: { parentPath: string; name: string }) => Promise<void>
  renameProject: (projectId: string, newName: string) => Promise<void>
  deleteProject: (projectId: string) => Promise<boolean>
  pinProject: (projectId: string) => Promise<void>
  unpinProject: (projectId: string) => Promise<void>
  archiveProject: (projectId: string) => Promise<void>
  unarchiveProject: (projectId: string) => Promise<void>
  reorderProjects: (orderedIds: string[]) => void
  reorderPinnedProjects: (orderedIds: string[]) => void
  toggleShowArchived: () => void
}

/**
 * Per-project issue/view state that participates in the `_projectStates`
 * save/restore cycle.  Issue data (issueById, issueDetailCache, etc.)
 * lives in `issueStore` — these are only the UI state fields.
 */
interface IssueViewStateSlice {
  /** Selected issue ID (keeps list highlighting in sync on restore). */
  selectedIssueId: string | null
  /** Active custom view / "All" view on the Issues tab — per-project state. */
  activeViewId: string
  /** Transient filter state applied on top of the active view — per-project state. */
  ephemeralFilters: EphemeralFilters
  /** In-memory display config for the All view (sort/groupBy) — per-project state. */
  allViewDisplay: ViewDisplayConfig
  setActiveView: (viewId: string) => void
  setEphemeralFilters: (filters: EphemeralFilters) => void
  /** Update the All view's display config (in-memory only). */
  setAllViewDisplay: (display: ViewDisplayConfig) => void
}

interface AppLifecycleSlice {
  /** True once the initial data load (get-initial-state + supplementary IPCs) completes. */
  appReady: boolean
  setAppReady: (ready: boolean) => void
}

export type AppStore = AppLifecycleSlice &
  SessionsSlice &
  NavigationSlice &
  UISlice &
  IssueViewStateSlice

// ─── Store Implementation ───────────────────────────────────────────

export const useAppStore = create<AppStore>((set, get) => ({
  // App lifecycle
  appReady: false,
  setAppReady: (ready) => set({ appReady: ready }),

  // Sessions slice
  projects: [],
  sessions: [],
  detailContext: null,
  selectedSessionDetail: null,
  _tabDetails: { ...EMPTY_TAB_DETAILS },
  statusFilter: 'all',
  setProjects: (projects) => set({ projects }),
  updateProjectById: (projectId, updater) =>
    set((s) => ({
      projects: s.projects.map((project) => (project.id === projectId ? updater(project) : project)),
    })),
  setSessions: (sessions) => set({ sessions }),
  selectSession: (sessionId, highlightTurnIndex) => {
    if (sessionId) {
      const ctx: DetailContext = { type: 'session', sessionId, highlightTurnIndex }
      set((s) => ({
        detailContext: ctx,
        _tabDetails: { ...s._tabDetails, 'chat.sessions': ctx }
      }))
    } else {
      set((s) => ({
        detailContext: null,
        selectedSessionDetail: null,
        _tabDetails: { ...s._tabDetails, 'chat.sessions': null }
      }))
    }
  },
  openDetail: (ctx) =>
    set((s) => ({
      detailContext: ctx,
      _tabDetails: { ...s._tabDetails, [resolveSlotForContext(ctx)]: ctx }
    })),
  closeDetail: () =>
    set((s) => {
      const tab = s.appView.mode === 'projects' ? s.appView.tab : 'dashboard'
      const slot = activeSlotForTab(tab, s.chatSubTab)
      return {
        detailContext: null,
        selectedSessionDetail: null,
        _tabDetails: { ...s._tabDetails, [slot]: null }
      }
    }),
  setSessionDetail: (detail) => set({ selectedSessionDetail: detail }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),

  // Navigation slice
  appView: { mode: 'projects' as const, tab: 'issues' as const, projectId: null },

  navigateToProject: (projectId) => {
    const prev = get()
    const isSameProject =
      prev.appView.mode === 'projects' && prev.appView.projectId === projectId
    // Determine cross-project transition BEFORE set() for issueStore side-effect
    const isCrossProject = !isSameProject

    set((s) => {
      // ── Same-project click is a no-op (idempotent) ─────────────
      if (isSameProject) return {}

      // ── All other transitions: save outgoing + restore target ──
      //
      // Covers:
      //   • Project A → Project B   (direct switch)
      //   • Schedule → Project B    (Schedule on A, switching to B)
      //   • Inbox → Project X       (navigateToInbox already saved)
      //
      // Note: issueDetailCache is cleared separately via issueStore
      // since issue IDs are project-scoped and stale data from the
      // previous project should not be shown.
      const updatedStates = saveCurrentProjectState(s)
      const targetKey = projectMemoryKey(projectId)
      const hasSavedState = targetKey in updatedStates
      const target = getProjectState(updatedStates, projectId)
      const project = projectId ? s.projects.find((p) => p.id === projectId) : null
      const firstVisit = resolveFirstVisitProjectState(project ?? null, s.appView.mode === 'projects' ? s.appView.tab : 'issues')

      // For return visits, restore the saved tab.
      // For first-visit projects, use project preference when available.
      const tab = hasSavedState ? target.lastTab : firstVisit.lastTab

      // Use the target project's chatSubTab (not the current global one)
      // so that the detail slot resolves to the correct sub-tab context.
      const targetChatSubTab = target.chatSubTab
      const slot = activeSlotForTab(tab, targetChatSubTab)
      const nextFilesDisplayModeByProject =
        !hasSavedState && projectId && firstVisit.filesDisplayMode
          ? { ...s.filesDisplayModeByProject, [projectId]: firstVisit.filesDisplayMode }
          : s.filesDisplayModeByProject

      return {
        _projectStates: updatedStates,
        appView: { mode: 'projects' as const, tab, projectId },
        // Transition-specific fields
        detailContext: target.tabDetails[slot] ?? null,
        selectedSessionDetail: null,
        // Restore all per-project state from the target snapshot
        ...projectStateToStore(target),
        ...(hasSavedState ? {} : { chatViewMode: firstVisit.chatViewMode }),
        filesDisplayModeByProject: nextFilesDisplayModeByProject,
      }
    })

    onCrossProjectTransition(isCrossProject)
  },

  navigateToSession: (projectId, sessionId) => {
    const prev = get()
    const isCrossProject =
      prev.appView.mode !== 'projects' || prev.appView.projectId !== projectId

    const ctx: DetailContext = { type: 'session', sessionId }
    set((s) => {
      // Save outgoing + restore target on cross-project navigation;
      // same-project just overlays the session slot.
      let projectSwitch: Partial<AppStore>
      if (isCrossProject) {
        const updatedStates = saveCurrentProjectState(s)
        const target = getProjectState(updatedStates, projectId)
        projectSwitch = {
          _projectStates: updatedStates,
          // Restore all per-project state (including statusFilter, searchQuery),
          // then overlay the session slot.
          ...projectStateToStore(target),
          _tabDetails: { ...target.tabDetails, 'chat.sessions': ctx },
        }
      } else {
        projectSwitch = {
          _tabDetails: { ...s._tabDetails, 'chat.sessions': ctx },
          // Same-project: clear filters so the target session is visible
          statusFilter: 'all',
          searchQuery: '',
        }
      }

      return {
        ...projectSwitch,
        appView: { mode: 'projects', tab: 'chat', projectId },
        detailContext: ctx,
        selectedSessionDetail: null,
        chatSubTab: 'sessions',
      }
    })

    onCrossProjectTransition(isCrossProject)
  },

  navigateToChatSession: (projectId, sessionId) => {
    const prev = get()
    const isCrossProject =
      prev.appView.mode !== 'projects' || prev.appView.projectId !== projectId

    set((s) => {
      let projectSwitch: Partial<AppStore>
      if (isCrossProject) {
        const updatedStates = saveCurrentProjectState(s)
        const target = getProjectState(updatedStates, projectId)
        projectSwitch = {
          _projectStates: updatedStates,
          // Restore all per-project state (including statusFilter, searchQuery)
          ...projectStateToStore(target),
        }
      } else {
        // Same-project: no project-level state to change.
        // statusFilter / searchQuery are session-list filters — irrelevant for
        // agent chat navigation (the old code cargo-culted this from navigateToSession).
        projectSwitch = {}
      }

      return {
        ...projectSwitch,
        appView: { mode: 'projects', tab: 'chat', projectId },
        agentChatSessionId: sessionId,
        // Chat session navigation should open in-chat context, not the right detail panel.
        detailContext: null,
        selectedSessionDetail: null,
        chatSubTab: 'conversation',
      }
    })

    onCrossProjectTransition(isCrossProject)
  },

  navigateToIssue: (projectId, issueId) => {
    const prev = get()
    const isCrossProject =
      prev.appView.mode !== 'projects' || prev.appView.projectId !== projectId

    const ctx: DetailContext = { type: 'issue', issueId }
    set((s) => {
      let projectSwitch: Partial<AppStore>
      if (isCrossProject) {
        const updatedStates = saveCurrentProjectState(s)
        const target = getProjectState(updatedStates, projectId)
        projectSwitch = {
          _projectStates: updatedStates,
          ...projectStateToStore(target),
          _tabDetails: { ...target.tabDetails, issues: ctx },
        }
      } else {
        projectSwitch = {
          _tabDetails: { ...s._tabDetails, issues: ctx },
        }
      }

      return {
        ...projectSwitch,
        appView: { mode: 'projects', tab: 'issues', projectId },
        detailContext: ctx,
        selectedIssueId: issueId,
      }
    })

    onCrossProjectTransition(isCrossProject)
    // Load full issue data for the detail view
    fireAndForget(useIssueStore.getState().loadIssueDetail(issueId), 'navigateToIssue.loadIssueDetail')
  },

  navigateToInbox: (selectedMessageId = null) =>
    set((s) => ({
      _projectStates: saveCurrentProjectState(s),
      appView: { mode: 'inbox' as const, selectedMessageId },
      // Reset project-scoped transient UI state so it doesn't leak into
      // Inbox mode or persist stale values when returning to a project.
      // selectedIssueId is already saved in _projectStates above — clearing
      // it here is purely defensive (no component should read it in inbox
      // mode, but it maintains symmetry with deleteProject's cleanup).
      selectedIssueId: null,
      detailContext: null,
      selectedSessionDetail: null,
      agentChatSessionId: null,
      chatSubTab: 'conversation' as const,
      chatViewMode: 'default' as const,
    })),

  setMainTab: (tab) =>
    set((s) => {
      if (s.appView.mode === 'projects' && s.appView.tab === tab) return {}
      const projectId = s.appView.mode === 'projects' ? s.appView.projectId : null
      const slot = activeSlotForTab(tab, s.chatSubTab)

      // Eagerly persist tabs to _projectStates so project-switch and inbox-return
      // can restore the exact last tab for that project (including schedule).
      const key = projectMemoryKey(projectId)
      const saveTab: Partial<AppStore> = {
        _projectStates: { ...s._projectStates, [key]:
          captureProjectSnapshot(s, { lastTab: tab }),
        }
      }

      return {
        ...saveTab,
        appView: { mode: 'projects' as const, tab, projectId },
        detailContext: s._tabDetails[slot] ?? null,
        selectedSessionDetail: null,
      }
    }),

  // UI slice
  searchQuery: '',
  commandPaletteOpen: false,
  aboutDialogOpen: false,
  runtimeVersions: null,
  onboarding: { completed: false, hooksInstalled: false },
  showArchived: false,
  leftSidebarExpanded: true,
  setLeftSidebarExpanded: (expanded) => set({ leftSidebarExpanded: expanded }),
  sessionsViewMode: 'list',
  chatSubTab: 'conversation',
  agentChatSessionId: null,
  chatViewMode: 'default',
  _projectStates: {},
  filesDisplayModeByProject: {},
  agentSidebarExpanded: false,
  setAgentSidebarExpanded: (expanded) => set({ agentSidebarExpanded: expanded }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  openAboutDialog: () => set({ aboutDialogOpen: true }),
  closeAboutDialog: () => set({ aboutDialogOpen: false }),
  setRuntimeVersions: (versions) => set({ runtimeVersions: versions }),
  setSessionsViewMode: (mode) => set({ sessionsViewMode: mode }),
  setChatSubTab: (subTab) =>
    set((s) => {
      if (s.chatSubTab === subTab) return {}
      const slot = activeSlotForTab('chat', subTab)

      // Eagerly persist chatSubTab to _projectStates so project restore resolves
      // the correct chat detail slot.
      const projectId = s.appView.mode === 'projects' ? s.appView.projectId : null
      const key = projectMemoryKey(projectId)
      const updatedStates: Partial<AppStore> = {
        _projectStates: { ...s._projectStates, [key]:
          captureProjectSnapshot(s, { chatSubTab: subTab }),
        },
      }

      return {
        ...updatedStates,
        chatSubTab: subTab,
        // Derive active detail from the target sub-tab's slot
        detailContext: s._tabDetails[slot] ?? null,
        selectedSessionDetail: null,
      }
    }),
  setAgentChatSessionId: (sessionId) => set({ agentChatSessionId: sessionId }),
  setChatViewMode: (mode) => set({ chatViewMode: mode }),
  setFilesDisplayMode: (projectId, mode) =>
    set((s) => {
      if (s.filesDisplayModeByProject[projectId] === mode) return {}
      return {
        filesDisplayModeByProject: { ...s.filesDisplayModeByProject, [projectId]: mode }
      }
    }),
  setOnboarding: (state) => set({ onboarding: state }),
  addProject: async () => {
    const selectedPath = await getAppAPI()['select-directory']()
    if (!selectedPath) return // user cancelled
    // Project list update is handled by the DataBus sessions:updated event
    // dispatched from syncRuntimeProjectsFromStore() in the backend handler.
    await getAppAPI()['create-project']({ path: selectedPath })
  },
  createNewProject: async (input) => {
    // Project list update is handled by the DataBus sessions:updated event
    // dispatched from syncRuntimeProjectsFromStore() in the backend handler.
    // We only use the return value for navigation metadata (project ID).
    const project = await getAppAPI()['create-new-project'](input)
    get().navigateToProject(project.id)
  },
  renameProject: async (projectId, newName) => {
    // Project list update is handled by the DataBus sessions:updated event.
    await getAppAPI()['rename-project']({ id: projectId, newName })
  },
  deleteProject: async (projectId) => {
    // Exceptions propagate to the caller (useDeleteProject hook) which handles toast feedback.
    // The store layer is responsible only for IPC communication and state synchronisation.
    const success = await getAppAPI()['delete-project'](projectId)
    if (!success) return false

    // Read issueStore snapshot before set() to check for orphaned selection
    const issueState = useIssueStore.getState()

    set((s) => {
      const isSelected = s.appView.mode === 'projects' && s.appView.projectId === projectId
      const currentTab = s.appView.mode === 'projects' ? s.appView.tab : 'issues'

      // Determine whether the currently selected issue belongs to the deleted project (O(1))
      const isSelectedIssueOrphaned = s.selectedIssueId != null &&
        issueState.issueById[s.selectedIssueId]?.projectId === projectId

      // Drop per-project entries to prevent memory leaks
      const { [projectId]: _droppedState, ...remainingProjectStates } = s._projectStates
      const { [projectId]: _droppedDisplay, ...remainingDisplayModes } = s.filesDisplayModeByProject

      return {
        // Core: remove the project
        projects: s.projects.filter((p) => p.id !== projectId),

        // Cascade: clean up per-project config (single map + display modes)
        _projectStates: remainingProjectStates,
        filesDisplayModeByProject: remainingDisplayModes,

        // Cascade: clear orphaned issue selection
        ...(isSelectedIssueOrphaned
          ? {
              selectedIssueId: null,
              detailContext: null,
              _tabDetails: { ...s._tabDetails, issues: null },
            }
          : {}),

        // Cascade: reset navigation when viewing the deleted project
        ...(isSelected
          ? {
              appView: { mode: 'projects' as const, tab: currentTab, projectId: null },
              detailContext: null,
              selectedSessionDetail: null,
              _tabDetails: { ...EMPTY_TAB_DETAILS },
              chatSubTab: 'conversation' as const,
              agentChatSessionId: null,
              chatViewMode: 'default' as const,
            }
          : {}),
      }
    })

    // Cascade: remove associated issues from issueStore
    useIssueStore.getState().removeIssuesForProject(projectId)

    return true
  },
  pinProject: async (projectId) => {
    // Project list update is handled by the DataBus sessions:updated event.
    await getAppAPI()['pin-project'](projectId)
  },
  unpinProject: async (projectId) => {
    // Project list update is handled by the DataBus sessions:updated event.
    await getAppAPI()['unpin-project'](projectId)
  },
  archiveProject: async (projectId) => {
    // Project list update is handled by the DataBus sessions:updated event.
    await getAppAPI()['archive-project'](projectId)
  },
  unarchiveProject: async (projectId) => {
    // Project list update is handled by the DataBus sessions:updated event.
    await getAppAPI()['unarchive-project'](projectId)
  },
  toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),

  reorderProjects: (orderedIds) => {
    // Optimistic reorder: update displayOrder in local state
    const prevProjects = get().projects
    set((s) => ({
      projects: s.projects.map((p) => {
        const idx = orderedIds.indexOf(p.id)
        return idx === -1 ? p : { ...p, displayOrder: idx }
      })
    }))
    fireAndForget(
      getAppAPI()['reorder-projects'](orderedIds).catch(() => {
        set({ projects: prevProjects })
      }),
      'reorderProjects',
    )
  },

  reorderPinnedProjects: (orderedIds) => {
    // Optimistic reorder: update pinOrder in local state
    const prevProjects = get().projects
    set((s) => ({
      projects: s.projects.map((p) => {
        const idx = orderedIds.indexOf(p.id)
        return idx === -1 ? p : { ...p, pinOrder: idx }
      })
    }))
    fireAndForget(
      getAppAPI()['reorder-pinned-projects'](orderedIds).catch(() => {
        set({ projects: prevProjects })
      }),
      'reorderPinnedProjects',
    )
  },

  // ── Issue/View per-project state ──────────────────────────────────
  // Issue data lives in issueStore; only per-project UI state lives here.

  selectedIssueId: null,
  activeViewId: ALL_VIEW.id,
  ephemeralFilters: {},
  allViewDisplay: { ...ALL_VIEW.display },

  // Pure state setters — cross-store coordination (loadIssues) is handled
  // by issueActions.setActiveView / issueActions.setEphemeralFilters.
  // Components that need the coordinated behavior should import from
  // '@/actions/issueActions' instead of using these store methods directly.
  setActiveView: (viewId) => set({ activeViewId: viewId, ephemeralFilters: {} }),

  setEphemeralFilters: (filters) => set({ ephemeralFilters: filters }),

  setAllViewDisplay: (display) => set({ allViewDisplay: display }),
}))

// ─── Derived Selectors ──────────────────────────────────────────────

export function selectProjectId(store: AppStore): string | null {
  return store.appView.mode === 'projects' ? store.appView.projectId : null
}

export function selectProjectPath(store: AppStore): string | undefined {
  const id = selectProjectId(store)
  return id ? store.projects.find((p) => p.id === id)?.path : undefined
}

export function selectMainTab(store: AppStore): MainTab {
  return store.appView.mode === 'projects' ? store.appView.tab : 'dashboard'
}
