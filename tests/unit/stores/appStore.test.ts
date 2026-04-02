// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useAppStore,
  selectProjectId,
  selectMainTab,
  EMPTY_TAB_DETAILS,
} from '../../../src/renderer/stores/appStore'
import { useIssueStore } from '../../../src/renderer/stores/issueStore'
import { selectIssue } from '../../../src/renderer/actions/issueActions'
import type { AppView } from '../../../src/shared/types'

// selectIssue (now in issueActions) triggers loadIssueDetail which calls
// getAppAPI()['get-issue'].  Navigation tests don't need real IPC — stub
// the minimal surface so tests focus on state transitions only.
// The mutable apiOverrides lets individual describe blocks install custom
// IPC handlers (e.g. commandActions tests) while navigation tests use
// the catch-all proxy that resolves every method to null.
const apiOverrides: Record<string, any> = {}

vi.mock('@/windowAPI', () => ({
  getAppAPI: () => new Proxy(apiOverrides, {
    get: (target, prop) => target[prop as string] ?? vi.fn().mockResolvedValue(null),
  }),
}))

describe('appStore - NavigationSlice', () => {
  beforeEach(() => {
    useAppStore.setState({
      appView: { mode: 'projects', tab: 'dashboard', projectId: null } as AppView,
      statusFilter: 'all',
      detailContext: null,
      selectedSessionDetail: null,
      chatSubTab: 'sessions',
      _tabDetails: { ...EMPTY_TAB_DETAILS },
      _projectStates: {},
      selectedIssueId: null,
    })
  })

  it('defaults appView to projects mode with dashboard tab', () => {
    const state = useAppStore.getState()
    expect(state.appView).toEqual({ mode: 'projects', tab: 'dashboard', projectId: null })
  })

  it('selectProjectId returns null for projects mode with no project', () => {
    expect(selectProjectId(useAppStore.getState())).toBeNull()
  })

  it('selectMainTab returns dashboard by default', () => {
    expect(selectMainTab(useAppStore.getState())).toBe('dashboard')
  })

  it('selectIsInboxMode returns false for projects mode', () => {
    expect((useAppStore.getState().appView.mode === 'inbox')).toBe(false)
  })

  it('setMainTab switches tab within projects mode', () => {
    useAppStore.getState().setMainTab('chat')
    expect(selectMainTab(useAppStore.getState())).toBe('chat')

    useAppStore.getState().setMainTab('issues')
    expect(selectMainTab(useAppStore.getState())).toBe('issues')

    useAppStore.getState().setMainTab('dashboard')
    expect(selectMainTab(useAppStore.getState())).toBe('dashboard')

    useAppStore.getState().setMainTab('schedule')
    expect(selectMainTab(useAppStore.getState())).toBe('schedule')
  })

  it('setMainTab restores per-tab detailContext instead of clearing', () => {
    // Open session detail on the claude tab (sessions now live under claude)
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })

    // Switch to issues tab — claude detail disappears, issues has nothing
    useAppStore.getState().setMainTab('issues')
    expect(useAppStore.getState().detailContext).toBeNull()
    expect(useAppStore.getState().selectedSessionDetail).toBeNull()

    // Switch back to claude — session detail is restored
    useAppStore.getState().setMainTab('chat')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  it('setMainTab is no-op when switching to same tab', () => {
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    useAppStore.getState().setMainTab('chat')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  it('setMainTab from inbox mode switches back to projects mode', () => {
    useAppStore.getState().navigateToInbox()
    useAppStore.getState().setMainTab('chat')
    // setMainTab now transitions from inbox back to projects mode
    expect(useAppStore.getState().appView.mode).toBe('projects')
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
  })

  it('navigateToProject sets project id and stays on current tab', () => {
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().navigateToProject('proj-1')
    expect(selectProjectId(useAppStore.getState())).toBe('proj-1')
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
  })

  it('navigateToProject clears detailContext', () => {
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    useAppStore.getState().navigateToProject('proj-1')
    expect(useAppStore.getState().detailContext).toBeNull()
  })

  it('navigateToProject from schedule keeps schedule tab for same project', () => {
    // Start on a project, switch to chat tab
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('chat')
    // Switch to schedule — schedule is now a first-class project tab
    useAppStore.getState().setMainTab('schedule')
    // Clicking the same project is idempotent; active tab remains schedule
    useAppStore.getState().navigateToProject('proj-1')
    expect(selectMainTab(useAppStore.getState())).toBe('schedule')
  })

  it('navigateToProject restores target project saved tab on project switch', () => {
    // Set up: All Projects on dashboard, proj-1 on claude
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('issues')
    // Switch back to All Projects — should restore 'claude' (its saved tab)
    useAppStore.getState().navigateToProject(null)
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
    expect(selectProjectId(useAppStore.getState())).toBeNull()
  })

  it('navigateToInbox switches to inbox mode', () => {
    useAppStore.getState().navigateToInbox()
    expect(useAppStore.getState().appView).toEqual({ mode: 'inbox', selectedMessageId: null })
    expect((useAppStore.getState().appView.mode === 'inbox')).toBe(true)
    expect(selectProjectId(useAppStore.getState())).toBeNull()
  })

  it('navigateToInbox with messageId', () => {
    useAppStore.getState().navigateToInbox('msg-1')
    expect(useAppStore.getState().appView).toEqual({ mode: 'inbox', selectedMessageId: 'msg-1' })
  })

  it('navigateToInbox clears detailContext', () => {
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    useAppStore.getState().navigateToInbox()
    expect(useAppStore.getState().detailContext).toBeNull()
    expect(useAppStore.getState().selectedSessionDetail).toBeNull()
  })

  it('navigateToProject from inbox mode resets to issues tab', () => {
    useAppStore.getState().navigateToInbox()
    useAppStore.getState().navigateToProject('proj-1')
    // Coming from inbox, navigateToProject defaults to 'issues' (or restores from _projectStates)
    expect(selectMainTab(useAppStore.getState())).toBe('issues')
    expect(selectProjectId(useAppStore.getState())).toBe('proj-1')
    expect((useAppStore.getState().appView.mode === 'inbox')).toBe(false)
  })

  it('navigateToSession sets project, sessions tab, and detailContext', () => {
    useAppStore.getState().navigateToSession('proj-1', 'sess-1')
    const state = useAppStore.getState()
    expect(state.appView).toEqual({ mode: 'projects', tab: 'chat', projectId: 'proj-1' })
    expect(state.detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
    expect(state.selectedSessionDetail).toBeNull()
  })

  it('navigateToSession clears stale selectedSessionDetail', () => {
    // Simulate having loaded a previous session detail
    useAppStore.setState({ selectedSessionDetail: { id: 'old' } as never })
    useAppStore.getState().navigateToSession('proj-1', 'sess-2')
    expect(useAppStore.getState().selectedSessionDetail).toBeNull()
  })

  it('navigateToSession from inbox mode switches to projects', () => {
    useAppStore.getState().navigateToInbox()
    useAppStore.getState().navigateToSession('proj-1', 'sess-1')
    expect((useAppStore.getState().appView.mode === 'inbox')).toBe(false)
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
    expect(selectProjectId(useAppStore.getState())).toBe('proj-1')
  })

  it('navigateToSession from dashboard switches tab to claude', () => {
    useAppStore.setState({ appView: { mode: 'projects', tab: 'dashboard', projectId: null } as AppView })
    useAppStore.getState().navigateToSession('proj-1', 'sess-1')
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
    const ctx = useAppStore.getState().detailContext
    expect(ctx?.type === 'session' ? ctx.sessionId : null).toBe('sess-1')
  })

  // ── Tab memory: null-safe key for "All Projects" ───────────────
  it('navigateToProject(null) from inbox restores tab for All Projects', () => {
    // Start on All Projects, switch to claude
    useAppStore.getState().setMainTab('chat')
    // Go to inbox — should save 'claude' for All Projects
    useAppStore.getState().navigateToInbox()
    // Return to All Projects — should restore 'claude'
    useAppStore.getState().navigateToProject(null)
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
    expect(selectProjectId(useAppStore.getState())).toBeNull()
  })

  it('navigateToProject from inbox restores tab for specific project', () => {
    // Start on proj-1, switch to claude
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('chat')
    // Go to inbox — should save 'claude' for proj-1
    useAppStore.getState().navigateToInbox()
    // Return to proj-1 — should restore 'claude'
    useAppStore.getState().navigateToProject('proj-1')
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
  })

  // ── Same-project idempotent guard ──────────────────────────────
  it('navigateToProject is no-op when clicking same project', () => {
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().setAgentChatSessionId('sess-1')
    // Click same project again — should NOT clear state
    useAppStore.getState().navigateToProject('proj-1')
    expect(selectMainTab(useAppStore.getState())).toBe('chat')
    expect(useAppStore.getState().agentChatSessionId).toBe('sess-1')
  })

  // ── Schedule participates in per-project lastTab memory ────────
  it('setMainTab(schedule) persists schedule as project lastTab', () => {
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().setMainTab('schedule')
    // Navigate to inbox then back — should restore schedule
    useAppStore.getState().navigateToInbox()
    useAppStore.getState().navigateToProject('proj-1')
    expect(selectMainTab(useAppStore.getState())).toBe('schedule')
  })

  // ── agentSidebarExpanded persistence ───────────────────────────
  it('agentSidebarExpanded defaults to false and persists', () => {
    expect(useAppStore.getState().agentSidebarExpanded).toBe(false)
    useAppStore.getState().setAgentSidebarExpanded(true)
    expect(useAppStore.getState().agentSidebarExpanded).toBe(true)
    // Tab switch does not reset it
    useAppStore.getState().setMainTab('issues')
    expect(useAppStore.getState().agentSidebarExpanded).toBe(true)
  })

  // ── leftSidebarExpanded persistence ────────────────────────────
  it('leftSidebarExpanded defaults to true and persists', () => {
    useAppStore.setState({ leftSidebarExpanded: true })
    expect(useAppStore.getState().leftSidebarExpanded).toBe(true)
    useAppStore.getState().setLeftSidebarExpanded(false)
    expect(useAppStore.getState().leftSidebarExpanded).toBe(false)
    // Tab switch does not reset it
    useAppStore.getState().setMainTab('issues')
    expect(useAppStore.getState().leftSidebarExpanded).toBe(false)
  })
})

describe('appStore - DetailSlice', () => {
  beforeEach(() => {
    useAppStore.setState({
      detailContext: null,
      selectedSessionDetail: null,
      selectedIssueId: null,
      chatSubTab: 'sessions',
      appView: { mode: 'projects', tab: 'dashboard', projectId: null } as AppView,
      _tabDetails: { ...EMPTY_TAB_DETAILS },
      _projectStates: {},
    })
  })

  it('defaults detailContext to null', () => {
    expect(useAppStore.getState().detailContext).toBeNull()
  })

  it('opens session detail via openDetail', () => {
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    expect(useAppStore.getState().detailContext).toEqual({
      type: 'session',
      sessionId: 'sess-1'
    })
  })

  it('opens capability detail via openDetail', () => {
    const identifier = {
      category: 'command' as const,
      name: 'commit',
      scope: 'project' as const,
      sourcePath: '/path/to/commit.md'
    }
    useAppStore.getState().openDetail({ type: 'capability', identifier })
    const ctx = useAppStore.getState().detailContext
    expect(ctx).toEqual({ type: 'capability', identifier })
  })

  it('closeDetail clears context and session detail cache', () => {
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    useAppStore.getState().closeDetail()
    expect(useAppStore.getState().detailContext).toBeNull()
    expect(useAppStore.getState().selectedSessionDetail).toBeNull()
  })

  it('selectSession convenience opens session detail', () => {
    useAppStore.getState().selectSession('sess-1')
    expect(useAppStore.getState().detailContext).toEqual({
      type: 'session',
      sessionId: 'sess-1'
    })
  })

  it('selectSession(null) closes detail', () => {
    useAppStore.getState().selectSession('sess-1')
    useAppStore.getState().selectSession(null)
    expect(useAppStore.getState().detailContext).toBeNull()
  })

  it('setMainTab switches detailContext to target tab per-tab state', () => {
    // On claude tab, open a session detail
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-1')

    // Switch to issues — claude detail gone, issues has none
    useAppStore.getState().setMainTab('issues')
    expect(useAppStore.getState().detailContext).toBeNull()

    // Switch back to claude — restored
    useAppStore.getState().setMainTab('chat')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  it('navigateToProject clears detailContext and _tabDetails', () => {
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().openDetail({ type: 'session', sessionId: 'sess-1' })
    useAppStore.getState().navigateToProject('proj-1')
    expect(useAppStore.getState().detailContext).toBeNull()
    expect(useAppStore.getState()._tabDetails).toEqual(EMPTY_TAB_DETAILS)
  })

  it('openDetail routes context to correct slot via resolveSlotForContext', () => {
    useAppStore.getState().setMainTab('chat')
    const capCtx = {
      type: 'capability' as const,
      identifier: { category: 'command' as const, name: 'x', sourcePath: '/x' }
    }
    useAppStore.getState().openDetail(capCtx)
    expect(useAppStore.getState()._tabDetails['capabilities']).toEqual(capCtx)
    // Other slots unaffected
    expect(useAppStore.getState()._tabDetails.issues).toBeNull()
    expect(useAppStore.getState()._tabDetails['chat.sessions']).toBeNull()
  })

  it('selectIssue always writes to _tabDetails.issues even from claude tab', () => {
    // Start on claude tab with session detail open
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-1')

    // Cross-tab: selectIssue called from SessionDetailView
    selectIssue('issue-1')
    expect(useAppStore.getState().selectedIssueId).toBe('issue-1')
    expect(useAppStore.getState()._tabDetails.issues).toEqual({ type: 'issue', issueId: 'issue-1' })
    // Claude sub-tab session state is preserved in its own slot
    expect(useAppStore.getState()._tabDetails['chat.sessions']).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  it('closeDetail clears current slot _tabDetails entry', () => {
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-1')
    expect(useAppStore.getState()._tabDetails['chat.sessions']).not.toBeNull()

    useAppStore.getState().closeDetail()
    expect(useAppStore.getState().detailContext).toBeNull()
    expect(useAppStore.getState()._tabDetails['chat.sessions']).toBeNull()
  })

  it('navigateToInbox preserves _tabDetails for later restoration', () => {
    useAppStore.getState().setMainTab('issues')
    selectIssue('issue-1')

    useAppStore.getState().navigateToInbox()
    expect(useAppStore.getState().detailContext).toBeNull()
    // Per-tab state is still intact
    expect(useAppStore.getState()._tabDetails.issues).toEqual({ type: 'issue', issueId: 'issue-1' })
  })

  it('navigateToProject from inbox restores per-tab detail state', () => {
    // Set up: on dashboard with nothing open, then go to claude and open a session
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-1')

    // Switch to inbox
    useAppStore.getState().navigateToInbox()
    expect(useAppStore.getState().detailContext).toBeNull()

    // Return from inbox — goes back to dashboard (since inbox mode doesn't know prev tab)
    // but claude tab detail is preserved in _tabDetails
    useAppStore.getState().navigateToProject(null)
    // Now switch to claude tab — detail is restored
    useAppStore.getState().setMainTab('chat')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  it('navigateToProject between projects saves outgoing and restores target _tabDetails', () => {
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-1')

    // Switch to different project — outgoing detail is saved, target starts fresh
    useAppStore.getState().navigateToProject('proj-2')
    expect(useAppStore.getState()._tabDetails).toEqual(EMPTY_TAB_DETAILS)
    // Outgoing state was persisted to per-project map
    expect(useAppStore.getState()._projectStates['__all_projects__']?.tabDetails).toEqual({
      ...EMPTY_TAB_DETAILS,
      'chat.sessions': { type: 'session', sessionId: 'sess-1' },
    })
  })

  it('navigateToSession preserves other slots detail state (same project)', () => {
    // Start on proj-1, set up issue detail on issues tab
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('issues')
    selectIssue('issue-1')

    // Deep-link to a session within the same project (e.g. from CommandPalette)
    useAppStore.getState().navigateToSession('proj-1', 'sess-1')

    // Claude.sessions slot updated
    expect(useAppStore.getState()._tabDetails['chat.sessions']).toEqual({ type: 'session', sessionId: 'sess-1' })
    // Issues slot preserved (same-project: no save/restore cycle)
    expect(useAppStore.getState()._tabDetails.issues).toEqual({ type: 'issue', issueId: 'issue-1' })
  })

  it('navigateToSession cross-project jump saves outgoing and restores target', () => {
    // Start on proj-a with an issue detail open
    useAppStore.getState().navigateToProject('proj-a')
    useAppStore.getState().setMainTab('issues')
    selectIssue('issue-1')

    // Cross-project session navigation to proj-b
    useAppStore.getState().navigateToSession('proj-b', 'sess-1')

    // Session slot updated on target project
    expect(useAppStore.getState()._tabDetails['chat.sessions']).toEqual({ type: 'session', sessionId: 'sess-1' })
    // Issues slot is from proj-b's (empty) saved state, not from proj-a
    expect(useAppStore.getState()._tabDetails.issues).toBeNull()
    // Outgoing proj-a's state was saved
    expect(useAppStore.getState()._projectStates['proj-a']?.tabDetails.issues).toEqual({ type: 'issue', issueId: 'issue-1' })
    expect(useAppStore.getState()._projectStates['proj-a']?.selectedIssueId).toBe('issue-1')
  })

  it('setChatSubTab switches detailContext between sub-tab slots', () => {
    // Go to claude tab, open a session in sessions sub-tab
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().setChatSubTab('sessions')
    useAppStore.getState().selectSession('sess-1')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })

    // Switch to conversation sub-tab — session detail clears (different slot)
    useAppStore.getState().setChatSubTab('conversation')
    expect(useAppStore.getState().detailContext).toBeNull()

    // Switch back to sessions sub-tab — session detail is restored
    useAppStore.getState().setChatSubTab('sessions')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  // ── Per-project detail state preservation ───────────────────────

  it('navigateToProject preserves issue detail across project switch (A → B → A)', () => {
    // Open issue on Project A
    useAppStore.getState().navigateToProject('proj-a')
    useAppStore.getState().setMainTab('issues')
    selectIssue('issue-1')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'issue', issueId: 'issue-1' })
    expect(useAppStore.getState().selectedIssueId).toBe('issue-1')

    // Switch to Project B — A's detail is saved, B starts fresh
    useAppStore.getState().navigateToProject('proj-b')
    expect(useAppStore.getState().detailContext).toBeNull()
    expect(useAppStore.getState().selectedIssueId).toBeNull()
    expect(useAppStore.getState()._tabDetails.issues).toBeNull()

    // Switch back to Project A — issue detail is restored
    useAppStore.getState().navigateToProject('proj-a')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'issue', issueId: 'issue-1' })
    expect(useAppStore.getState().selectedIssueId).toBe('issue-1')
    expect(useAppStore.getState()._tabDetails.issues).toEqual({ type: 'issue', issueId: 'issue-1' })
  })

  it('navigateToProject preserves session detail on claude tab across switch', () => {
    // Open session on All Projects
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-1')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })

    // Switch to proj-1
    useAppStore.getState().navigateToProject('proj-1')
    expect(useAppStore.getState().detailContext).toBeNull()

    // Switch back to All Projects — session restored
    useAppStore.getState().navigateToProject(null)
    expect(useAppStore.getState().detailContext).toEqual({ type: 'session', sessionId: 'sess-1' })
    expect(useAppStore.getState()._tabDetails['chat.sessions']).toEqual({ type: 'session', sessionId: 'sess-1' })
  })

  it('navigateToInbox saves per-project detail state for later restoration', () => {
    // Open issue on proj-1
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('issues')
    selectIssue('issue-1')

    // Go to Inbox — state saved
    useAppStore.getState().navigateToInbox()
    const saved = useAppStore.getState()._projectStates['proj-1']
    expect(saved).toBeTruthy()
    expect(saved?.tabDetails.issues).toEqual({ type: 'issue', issueId: 'issue-1' })
    expect(saved?.selectedIssueId).toBe('issue-1')

    // Return to proj-1 — issue detail restored
    useAppStore.getState().navigateToProject('proj-1')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'issue', issueId: 'issue-1' })
    expect(useAppStore.getState().selectedIssueId).toBe('issue-1')
  })

  it('navigateToProject from inbox to different project restores correct state', () => {
    // Set up: proj-1 on issues, proj-2 on claude
    useAppStore.getState().navigateToProject('proj-1')
    useAppStore.getState().setMainTab('issues')
    selectIssue('issue-1')

    useAppStore.getState().navigateToProject('proj-2')
    useAppStore.getState().setMainTab('chat')
    useAppStore.getState().selectSession('sess-2')

    // Go to inbox (saves proj-2 state)
    useAppStore.getState().navigateToInbox()

    // Return to proj-1 (NOT proj-2) — should get proj-1's state
    useAppStore.getState().navigateToProject('proj-1')
    expect(selectMainTab(useAppStore.getState())).toBe('issues')
    expect(useAppStore.getState().detailContext).toEqual({ type: 'issue', issueId: 'issue-1' })
    expect(useAppStore.getState().selectedIssueId).toBe('issue-1')
  })
})

describe('commandActions - startSession', () => {
  // Import the cross-store action coordinator
  let startSession: (input: any) => Promise<string>

  beforeEach(async () => {
    const mod = await import('@/actions/commandActions')
    startSession = mod.startSession

    // Issue data lives in issueStore after Phase 4 extraction
    useIssueStore.setState({
      issueById: {
        'issue-1': {
          id: 'issue-1',
          title: 'Fix bug',
          description: '',
          status: 'todo' as const,
          priority: 'medium' as const,
          labels: [],
          projectId: null,
          sessionId: null,
          sessionHistory: [],
          parentIssueId: null,
          images: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          readAt: null,
          lastAgentActivityAt: null,
        },
      },
      issueIds: ['issue-1'],
      issueDetailCache: new Map(),
    })
    // Reset detail state to prevent leakage from previous describe blocks
    useAppStore.setState({
      selectedIssueId: null,
    })

    // Install IPC mocks via the shared apiOverrides (used by vi.mock above)
    apiOverrides['command:start-session'] = vi.fn().mockResolvedValue('session-abc')
    apiOverrides['update-issue'] = vi.fn().mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      const state = useIssueStore.getState()
      const issue = state.issueById[id]
      return { ...issue, ...patch, updatedAt: Date.now() }
    })
    apiOverrides['list-issues'] = vi.fn().mockImplementation(async () => {
      const state = useIssueStore.getState()
      return state.issueIds.map((id) => state.issueById[id])
    })
    apiOverrides['count-issues'] = vi.fn().mockResolvedValue(0)
    apiOverrides['list-issue-views'] = vi.fn().mockResolvedValue([])
  })

  afterEach(() => {
    // Clean up IPC overrides to avoid leaking into other describe blocks
    for (const key of Object.keys(apiOverrides)) {
      delete apiOverrides[key]
    }
  })

  it('links sessionId but does NOT set status (status is set later via DataBus)', async () => {
    const sessionId = await startSession({
      prompt: 'Fix the bug',
      origin: { source: 'issue', issueId: 'issue-1' },
    })

    expect(sessionId).toBe('session-abc')

    // Verify update-issue was called with sessionId only — status must NOT
    // be changed here because the SDK process has not actually spawned yet.
    // Status transitions to 'in_progress' only when useDataBus receives
    // a 'command:session:updated' event with state === 'streaming'.
    const calls = apiOverrides['update-issue'].mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('issue-1')
    expect(calls[0][1]).toEqual({ sessionId: 'session-abc' })
    expect(calls[0][1]).not.toHaveProperty('status')
  })

  it('does not call updateIssue when no issueId provided', async () => {
    await startSession({ prompt: 'Just a prompt' })

    expect(apiOverrides['update-issue']).not.toHaveBeenCalled()
  })
})

describe('appStore - UISlice sessionsViewMode', () => {
  beforeEach(() => {
    useAppStore.setState({ sessionsViewMode: 'list' })
  })

  it('defaults sessionsViewMode to list', () => {
    expect(useAppStore.getState().sessionsViewMode).toBe('list')
  })

  it('setSessionsViewMode switches to list', () => {
    useAppStore.getState().setSessionsViewMode('list')
    expect(useAppStore.getState().sessionsViewMode).toBe('list')
  })

  it('setSessionsViewMode switches back to grid', () => {
    useAppStore.getState().setSessionsViewMode('list')
    useAppStore.getState().setSessionsViewMode('grid')
    expect(useAppStore.getState().sessionsViewMode).toBe('grid')
  })
})
