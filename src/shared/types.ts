// SPDX-License-Identifier: Apache-2.0

import type { LogEntry } from './logger'
import type { LanguagePref } from './i18n'
import { IPC_EVENT_CHANNEL } from './appIdentity'
import type { GitRepositorySnapshot, GitLineDiff } from './gitTypes'
import type { FileAccessResult } from './fileAccess'

// === Core Data Models ===

export interface Project {
  id: string
  path: string
  name: string
  sessionCount: number
  pinOrder: number | null
  archivedAt: number | null
  displayOrder: number
  /** Epoch ms — last time the project record was touched (created, renamed, etc.). */
  updatedAt: number
}

export type SessionStatus = 'active' | 'waiting' | 'completed' | 'error'

export interface StatusTransition {
  sessionId: string
  sessionName: string
  previousStatus: SessionStatus
  newStatus: SessionStatus
  timestamp: number
}

export interface Session {
  id: string
  projectId: string
  name: string
  /** Slash command/skill name (e.g. "/yg.code.quality"); null for sessions not initiated by a command */
  commandName: string | null
  subtitle: string | null
  status: SessionStatus
  cwd: string
  gitBranch: string | null
  lastActivity: number
  startedAt: number
  taskSummary: TaskSummary
}

export interface TaskSummary {
  total: number
  completed: number
  inProgress: number
  pending: number
}

// === Session Content (Turn-based conversation model) ===

export interface ToolCallSummary {
  tool: string
  target: string
  durationMs: number
}

export interface TurnImage {
  dataUri: string // "data:image/png;base64,..."
  mediaType: string // "image/png"
  sizeBytes: number // approximate original byte size
}

export interface ConversationTurn {
  turnIndex: number
  userMessage: string
  assistantResponse: string
  toolCalls: ToolCallSummary[]
  filesAffected: string[]
  images: TurnImage[]
  startedAt: number
  endedAt: number
}

export interface SessionStats {
  durationMs: number
  turnCount: number
  toolCallCount: number
  filesAffected: string[]
  toolBreakdown: Record<string, number>
}

export interface SessionContent {
  turns: ConversationTurn[]
  stats: SessionStats
}

export interface SessionDetail extends Session {
  tasks: TaskFull[]
  events: HookEvent[]
  content: SessionContent
}

// === Session Content Search ===

export interface SessionSearchMatch {
  turnIndex: number
  field: 'user' | 'assistant'
  snippet: string // Contains <mark>…</mark> around matched text
}

export interface SessionSearchResult {
  sessionId: string
  matches: SessionSearchMatch[] // Max 3 per session
}

export interface HookEvent {
  timestamp: string
  rawEventName: string
  eventType: HookEventType | null
  sessionId: string
  sourceEventId?: string | null
  payload: Record<string, unknown>
}

export type EngineEventSource = 'hook' | 'managed_runtime'

/**
 * Normalized runtime signal event used by cross-engine consumers (Inbox, etc.).
 *
 * EngineEvent is intentionally signal-only:
 * - `eventType` is never null (operational tool-level events are excluded)
 * - `sessionRef` stores the producer-side session reference
 */
export interface EngineEventEnvelope {
  eventId: string
  sourceEventId: string | null
  occurredAtMs: number
  source: EngineEventSource
  timestamp: string
  rawEventName: string
  eventType: HookEventType
  sessionRef: string
  payload: Record<string, unknown>
}

// === JSONL Session Entry ===

export interface SessionJSONLEntry {
  sessionId: string
  cwd: string
  gitBranch?: string
  type: string
  timestamp: string
  uuid: string
  message?: {
    role: string
    content: string | unknown[]
  }
  data?: Record<string, unknown>
}

// === IPC Channel Types ===

/** Runtime version information provided by the main process. */
export interface RuntimeVersions {
  electron: string
  chrome: string
  node: string
}

export interface SerializableAppState {
  projects: Project[]
  sessions: Session[]
  tasks: Record<string, TaskFull[]>
  stats: StatsSnapshot | null
  onboarding: OnboardingState
  inboxMessages: InboxMessage[]
  inboxUnreadCount: number
  settings: AppSettings | null
  providerStatus: ProviderStatus | null
  systemLocale: string
  /** Electron / Chrome / Node versions — displayed in the About dialog. */
  runtimeVersions: RuntimeVersions
}

export interface IPCChannels {
  'get-initial-state': { args: []; return: SerializableAppState }
  'install-hooks': { args: []; return: boolean }
  'uninstall-hooks': { args: []; return: boolean }
  'get-hooks-status': { args: []; return: boolean }
  // Update checker
  'check-for-updates': { args: []; return: UpdateCheckResult | null }
  'pin-project': { args: [projectId: string]; return: Project }
  'unpin-project': { args: [projectId: string]; return: Project }
  'archive-project': { args: [projectId: string]; return: Project }
  'unarchive-project': { args: [projectId: string]; return: Project }
  'reorder-projects': { args: [orderedIds: string[]]; return: void }
  'reorder-pinned-projects': { args: [orderedIds: string[]]; return: void }
  'get-onboarding-state': { args: []; return: OnboardingState }
  'complete-onboarding': { args: []; return: OnboardingState }
  'check-prerequisites': { args: []; return: PrerequisiteCheckResult }
  'discover-importable-projects': { args: []; return: DiscoveredProjectCandidate[] }
  'import-discovered-projects': {
    args: [projects: DiscoveredProjectCandidate[]]
    return: Project[]
  }
  // Git integration
  'git:get-status': { args: [projectPath: string]; return: GitRepositorySnapshot | null }
  'git:is-repo': { args: [projectPath: string]; return: boolean }
  'git:force-refresh': { args: [projectPath: string]; return: GitRepositorySnapshot | null }
  'git:file-diff': { args: [projectPath: string, filePath: string]; return: GitLineDiff[] }
  // File operations
  'list-project-files': { args: [projectPath: string, subPath?: string]; return: FileEntry[] }
  /** Recursively search project files by name/path query */
  'search-project-files': { args: [projectPath: string, query: string]; return: FileEntry[] }
  'read-file-content': { args: [projectPath: string, filePath: string]; return: FileContentReadResult }
  /**
   * Read a tool-referenced file within a managed session sandbox.
   * Relative paths are resolved against session.executionContext.cwd.
   */
  'view-tool-file-content': { args: [input: ViewToolFileContentInput]; return: FileContentReadResult }
  'save-file-content': {
    args: [projectPath: string, filePath: string, content: string]
    return: FileContentWriteResult
  }
  /** Download a file to user-chosen location via native Save dialog */
  'download-file': {
    args: [defaultFileName: string, content: string]
    return: { success: boolean; savedPath?: string }
  }
  'list-claude-capabilities': { args: [projectPath?: string]; return: ClaudeCapabilities }
  'read-capability-source': {
    args: [sourcePath: string, projectPath?: string]
    return: CapabilitySourceResult
  }
  // ── Capability Center ───────────────────────────────────────────
  'capability:snapshot': { args: [projectId?: string]; return: CapabilitySnapshot }
  'capability:import:pick-files': { args: []; return: string[] | null }
  'capability:import:discover': {
    args: [params: CapabilityDiscoverParams]
    return: CapabilityImportableItem[]
  }
  'capability:import:execute': {
    args: [
      params: {
        items: CapabilityImportableItem[]
        /** Import into this project; omit for global scope. */
        projectId?: string
      }
    ]
    return: CapabilityImportResult
  }
  'capability:save': {
    args: [params: CapabilitySaveParams]
    return: { success: boolean; filePath: string }
  }
  'capability:save-form': {
    args: [params: CapabilitySaveFormParams]
    return: { success: boolean; filePath: string }
  }
  'capability:delete': {
    args: [
      params: {
        category: ManagedCapabilityCategory
        name: string
        scope?: 'global' | 'project'
        projectId?: string
      }
    ]
    return: void
  }
  'capability:toggle': {
    args: [params: CapabilityToggleParams]
    return: void
  }
  'capability:set-tags': {
    args: [
      params: {
        scope: 'global' | 'project'
        category: ManagedCapabilityCategory
        name: string
        tags: string[]
        projectId?: string
      }
    ]
    return: void
  }
  'capability:test-mcp': {
    args: [
      params: { command: string; args?: string[]; env?: Record<string, string>; timeout?: number }
    ]
    return: { success: boolean; error?: string; version?: string }
  }
  'capability:publish': {
    args: [params: CapabilityPublishParams]
    return: void
  }
  'capability:unpublish': {
    args: [params: CapabilityPublishParams]
    return: void
  }
  'capability:sync': {
    args: [params?: { engineKind?: AIEngineKind }]
    return: { synced: string[]; errors: string[] }
  }
  'capability:detect-drift': {
    args: [params?: { engineKind?: AIEngineKind }]
    return: CapabilityDriftReport[]
  }
  // M6: diagnostics + version history
  'capability:diagnostics': { args: []; return: CapabilityDiagnostic[] }
  'capability:versions': {
    args: [params: { category: ManagedCapabilityCategory; name: string; limit?: number }]
    return: Array<{ id: number; contentHash: string; createdAt: number }>
  }
  'capability:version-detail': {
    args: [params: { id: number }]
    return: string | null
  }
  /** List sibling files in a skill bundle directory (excludes SKILL.md itself) */
  'capability:bundle-files': {
    args: [filePath: string, projectId?: string]
    return: BundleFileInfo[]
  }
  /** Read a file inside a capability skill bundle by bundle-relative path. */
  'capability:view-bundle-file-content': {
    args: [input: ViewCapabilityBundleFileContentInput]
    return: FileContentReadResult
  }
  // ── Clone (Cross-Project Copy) ─────────────────────────────────
  'capability:clone:discover': {
    args: [params: DiscoverClonableParams]
    return: ClonableCapability[]
  }
  'capability:clone:execute': {
    args: [params: CloneCapabilitiesParams]
    return: CloneResult
  }

  // === Skills Marketplace IPC Channels ===
  'market:providers': {
    args: []
    return: MarketProviderInfo[]
  }
  'market:search': {
    args: [params: MarketSearchParams]
    return: MarketGroupedSearchResult
  }
  'market:browse': {
    args: [params: MarketBrowseParams]
    return: MarketSearchResult
  }
  'market:detail': {
    args: [slug: string, marketplaceId: MarketplaceId]
    return: MarketSkillDetail
  }
  'market:install': {
    args: [
      params: {
        slug: string
        marketplaceId: MarketplaceId
        scope: 'global' | 'project'
        projectId?: string
        /** Namespace prefix for multi-capability packages (e.g. "superpowers"). */
        namespacePrefix?: string
      }
    ]
    return: MarketInstallResult
  }
  'market:analyze': {
    args: [slug: string, marketplaceId: MarketplaceId]
    return: MarketInstallPreview
  }
  /** Start a session-based analysis — returns sessionId for Session Console rendering. */
  'market:start-analysis-session': {
    args: [slug: string, marketplaceId: MarketplaceId]
    return: { sessionId: string }
  }
  /** Cancel an in-flight Agent analysis. Fire-and-forget — returns immediately. */
  'market:cancel-analyze': {
    args: [slug: string, marketplaceId: MarketplaceId]
    return: void
  }
  'market:resolve-install-path': {
    args: [params: { scope: 'global' | 'project'; projectId?: string; prefix?: string }]
    return: string
  }
  'market:check-updates': {
    args: []
    return: Array<{
      name: string
      currentVersion?: string
      latestVersion?: string
      marketplaceId: MarketplaceId
      slug: string
    }>
  }

  // ── Package Lifecycle ────────────────────────────────────────────
  'package:list': {
    args: [query?: { scope?: 'global' | 'project'; projectId?: string }]
    return: InstalledPackageInfo[]
  }
  'package:uninstall': {
    args: [params: { prefix: string; scope?: 'global' | 'project'; projectId?: string }]
    return: boolean
  }
  'package:verify': {
    args: [params: { prefix: string; scope?: 'global' | 'project'; projectId?: string }]
    return: { prefix: string; status: 'ok' | 'corrupted' | 'missing'; expectedHash: string; actualHash: string }
  }

  // ── Repo Sources ────────────────────────────────────────────────
  'repo-source:list': { args: []; return: RepoSource[] }
  'repo-source:create': { args: [input: RepoSourceInput]; return: RepoSource }
  'repo-source:update': {
    args: [id: string, input: RepoSourceUpdateInput]
    return: RepoSource
  }
  'repo-source:delete': { args: [id: string]; return: void }
  'repo-source:test-connection': {
    args: [id: string]
    return: { ok: boolean; error?: string }
  }
  'repo-source:sync': { args: [id: string]; return: RepoSource }
  'repo-source:browse': { args: [id: string]; return: RepoSourceBrowseResult }

  'list-inbox-messages': { args: [filter?: InboxFilter]; return: InboxMessage[] }
  'update-inbox-message': {
    args: [params: { id: string; status: InboxMessageStatus }]
    return: InboxMessage
  }
  'get-inbox-stats': { args: []; return: InboxStats }
  'dismiss-inbox-message': { args: [id: string]; return: boolean }
  'mark-all-inbox-read': { args: []; return: number }
  'list-issues': { args: [filter?: IssueFilter | IssueQueryFilter]; return: IssueSummary[] }
  'count-issues': { args: [filter?: IssueFilter | IssueQueryFilter]; return: number }
  'get-issue': { args: [id: string]; return: Issue | null }
  'create-issue': { args: [input: CreateIssueInput]; return: Issue }
  'update-issue': { args: [id: string, patch: UpdateIssueInput]; return: Issue | null }
  'delete-issue': { args: [id: string]; return: boolean }
  'mark-issue-read': { args: [id: string]; return: Issue | null }
  'mark-issue-unread': { args: [id: string]; return: Issue | null }
  'list-child-issues': { args: [parentId: string]; return: IssueSummary[] }
  'list-custom-labels': { args: []; return: string[] }
  'create-custom-label': { args: [label: string]; return: string[] }
  'delete-custom-label': { args: [label: string]; return: string[] }
  'update-custom-label': { args: [oldLabel: string, newLabel: string]; return: string[] }
  'get-context-candidates': { args: [filter?: ContextCandidateFilter]; return: { issues: IssueSummary[]; artifacts: Artifact[] } }
  // Issue Views
  'list-issue-views': { args: []; return: IssueView[] }
  'create-issue-view': { args: [input: CreateIssueViewInput]; return: IssueView }
  'update-issue-view': { args: [id: string, patch: UpdateIssueViewInput]; return: IssueView | null }
  'delete-issue-view': { args: [id: string]; return: boolean }
  'reorder-issue-views': { args: [orderedIds: string[]]; return: void }
  // Command Phase
  'command:start-session': { args: [input: StartSessionInput]; return: string }
  'command:send-message': {
    args: [sessionId: string, content: UserMessageContent]
    return: boolean
  }
  'command:stop-session': { args: [sessionId: string]; return: boolean }
  'command:resume-session': {
    args: [sessionId: string, content?: UserMessageContent]
    return: boolean
  }
  'command:answer-question': {
    args: [sessionId: string, requestId: string, answer: string]
    return: boolean
  }
  'command:list-managed-sessions': { args: []; return: SessionSnapshot[] }
  'command:get-managed-session': { args: [sessionId: string]; return: SessionSnapshot | null }
  'command:get-session-messages': { args: [sessionId: string]; return: ManagedSessionMessage[] }
  'command:delete-session': { args: [sessionId: string]; return: boolean }
  // Settings
  'get-settings': { args: []; return: AppSettings }
  'update-settings': { args: [settings: AppSettings]; return: AppSettings }
  // Provider
  'provider:get-status': { args: [engineKind?: AIEngineKind]; return: ProviderStatus }
  'provider:login': {
    args: [engineKind: AIEngineKind, mode: ApiProvider, params?: Record<string, unknown>]
    return: ProviderStatus
  }
  'provider:cancel-login': { args: [engineKind: AIEngineKind, mode: ApiProvider]; return: boolean }
  'provider:logout': { args: [engineKind: AIEngineKind, mode: ApiProvider]; return: boolean }
  'provider:get-credential': {
    args: [engineKind: AIEngineKind, mode: ApiProvider]
    return: ProviderCredentialInfo | null
  }
  // Webhooks
  'webhook:test': { args: [endpoint: WebhookEndpoint]; return: WebhookTestResult }
  // Messaging — unified multi-platform IM API
  'messaging:get-all-statuses': { args: []; return: IMConnectionStatus[] }
  'messaging:start': { args: [connectionId: string]; return: boolean }
  'messaging:stop': { args: [connectionId: string]; return: boolean }
  'messaging:test': { args: [connectionId: string]; return: { success: boolean; error?: string } }
  // Messaging — WeChat QR code login (platform-specific)
  'messaging:weixin-start-qr-login': { args: [connectionId: string]; return: { success: boolean; error?: string } }
  'messaging:weixin-cancel-qr-login': { args: [connectionId: string]; return: void }
  // App lifecycle
  'app:relaunch': { args: []; return: void }
  // Clipboard (Electron native — navigator.clipboard is unreliable in renderer)
  'clipboard:write-text': { args: [text: string]; return: void }
  // Project management
  'create-project': { args: [input: { path: string; name?: string }]; return: Project }
  'create-new-project': { args: [input: { parentPath: string; name: string }]; return: Project }
  'list-all-projects': { args: []; return: Project[] }
  'update-project': { args: [id: string, patch: { name?: string }]; return: Project | null }
  'rename-project': { args: [input: { id: string; newName: string }]; return: Project }
  'delete-project': { args: [id: string]; return: boolean }
  // Directory picker (native OS dialog)
  'select-directory': { args: []; return: string | null }
  // Session Notes
  'list-session-notes': { args: [issueId: string]; return: SessionNote[] }
  'count-session-notes-by-issue': { args: []; return: Record<string, number> }
  'create-session-note': { args: [input: CreateNoteInput]; return: SessionNote }
  'update-session-note': { args: [id: string, content: NoteContent]; return: SessionNote | null }
  'delete-session-note': { args: [id: string]; return: boolean }
  // Artifacts
  'list-artifacts': { args: [filter?: ArtifactFilter]; return: Artifact[] }
  'get-artifact-content': { args: [artifactId: string]; return: string | null }
  'update-artifact-meta': { args: [id: string, patch: ArtifactMetaPatch]; return: Artifact }
  'list-starred-artifacts': { args: [projectId?: string]; return: Artifact[] }
  'star-session-artifact': { args: [input: StarArtifactInput]; return: Artifact }
  'star-project-file': { args: [input: StarProjectFileInput]; return: Artifact }
  // Browser
  'browser:show': { args: [context?: BrowserShowContext]; return: void }
  'browser:hide': { args: []; return: void }
  'browser:create-profile': { args: [input: BrowserCreateProfileInput]; return: BrowserProfileInfo }
  'browser:list-profiles': { args: []; return: BrowserProfileInfo[] }
  'browser:delete-profile': { args: [profileId: string]; return: boolean }
  'browser:open-view': { args: [profileId: string]; return: string }
  'browser:close-view': { args: [viewId: string]; return: void }
  'browser:sync-bounds': { args: [params: BrowserSyncBoundsParams]; return: void }
  'browser:execute': { args: [command: BrowserCommandPayload]; return: BrowserCommandResultPayload }
  'browser:get-page-info': { args: [viewId: string]; return: BrowserPageInfoPayload | null }
  /**
   * Query the currently active browser view (displayed in the browser window).
   *
   * Needed because the browser workspace renderer may mount AFTER the
   * `browser:view:opened` DataBus event was dispatched (React useEffect
   * is async). This lets the renderer catch up on mount.
   */
  'browser:get-active-view': { args: []; return: BrowserActiveViewPayload | null }
  /**
   * Query the browser view associated with a specific session.
   *
   * Used by the browser workspace to display the correct view when the
   * browser window is opened with a `linkedSessionId` context.
   * Returns null if the session has not yet used any browser tools.
   */
  'browser:get-session-view': { args: [sessionId: string]; return: BrowserActiveViewPayload | null }
  /**
   * Returns the active WebContentsView info for a given issue (issue-standalone mode).
   * Used by the renderer as a catch-up query in case browser:view:opened fired before
   * useBrowserDataBus subscribed (React useEffect timing race).
   * Returns null if the issue has no view yet.
   */
  'browser:get-issue-view': { args: [issueId: string]; return: BrowserActiveViewPayload | null }
  /**
   * Query the current focus context (linked session / issue) so the renderer
   * can catch up on mount. Needed because `browser:context` DataBus events
   * fire before React's `useEffect` registers the IPC listener on first
   * window creation — those events are silently lost.
   */
  'browser:get-focused-context': { args: []; return: BrowserShowContext | null }
  /** Create or reuse a view based on BrowserSource, attach it to the main window, and display it */
  'browser:ensure-source-view': {
    args: [params: { source: BrowserSource; profileId?: string }]
    return: string
  }
  /** Switch the currently displayed view (triggered by Source Switcher) */
  'browser:display-source': {
    args: [params: { source: BrowserSource }]
    return: void
  }
  /** Detach view without destroying it (keep alive when closing the overlay) */
  'browser:detach-view': {
    args: [viewId: string]
    return: void
  }
  /** Re-attach a kept-alive view (when reopening the overlay) */
  'browser:reattach-view': {
    args: [viewId: string]
    return: void
  }
  /** Temporarily hide/show the WebContentsView (Overlay Guard + animation sync) */
  'browser:set-view-visible': {
    args: [params: { viewId: string; visible: boolean }]
    return: void
  }
  // Logging (renderer → main file transport)
  'log:write': { args: [entry: LogEntry]; return: void }
  // Tray Popover
  'tray-popover:open-main': { args: []; return: void }
  'tray-popover:navigate-issue': { args: [issueId: string, projectId: string]; return: void }
  'tray-popover:quit': { args: []; return: void }
  'tray-popover:resize': { args: [height: number]; return: void }
  'tray-popover:get-issues': { args: []; return: TrayIssueItem[] }
  // Schedule CRUD
  'schedule:list': { args: [filter?: ScheduleFilter]; return: Schedule[] }
  'schedule:get': { args: [id: string]; return: Schedule | null }
  'schedule:create': { args: [input: CreateScheduleInput]; return: Schedule }
  'schedule:update': { args: [id: string, patch: UpdateScheduleInput]; return: Schedule | null }
  'schedule:delete': { args: [id: string]; return: boolean }
  // Schedule Control
  'schedule:pause': { args: [id: string]; return: Schedule | null }
  'schedule:resume': { args: [id: string]; return: Schedule | null }
  'schedule:trigger-now': { args: [id: string]; return: ScheduleExecution }
  // Schedule Executions
  'schedule:list-executions': {
    args: [scheduleId: string, limit?: number]
    return: ScheduleExecution[]
  }
  // Schedule Preview
  'schedule:preview-next-runs': {
    args: [trigger: ScheduleTrigger, count: number]
    return: number[]
  }
  // Pipeline CRUD
  'pipeline:list': { args: []; return: SchedulePipeline[] }
  'pipeline:get': { args: [id: string]; return: SchedulePipeline | null }
  'pipeline:create': { args: [input: CreatePipelineInput]; return: SchedulePipeline }
  'pipeline:update': {
    args: [id: string, patch: UpdatePipelineInput]
    return: SchedulePipeline | null
  }
  'pipeline:delete': { args: [id: string]; return: boolean }
  // Evose
  'evose:fetch-apps': {
    args: [apiKey: string, baseUrl: string, workspaceIds: string[]]
    return: EvoseApp[]
  }
  // Terminal
  'terminal:ensure': { args: [params: TerminalSpawnParams]; return: TerminalInfo }
  'terminal:spawn': { args: [params: TerminalSpawnParams]; return: TerminalInfo }
  'terminal:write': { args: [id: string, data: string]; return: void }
  'terminal:resize': { args: [id: string, cols: number, rows: number]; return: void }
  'terminal:kill': { args: [id: string]; return: void }
  'terminal:kill-all': { args: []; return: void }
  'terminal:get-info': { args: [scope: TerminalScope]; return: TerminalInfo | null }
  'terminal:list': { args: []; return: TerminalInfo[] }
  'terminal:replay': { args: [id: string]; return: string }
}

// IPC_EVENT_CHANNEL is centrally maintained in appIdentity.ts; a mapped type is used here
// to ensure compile-time consistency without manual comment upkeep. Changing IPC_EVENT_CHANNEL
// will trigger TypeScript errors in all consumers automatically.
export type IPCEventChannels = {
  [K in typeof IPC_EVENT_CHANNEL]: DataBusEvent
} & {
  /** Sent by main process before hiding the tray popover window (exit animation). */
  'tray-popover:will-hide': void
}

// === Project Grouping ===

export type ProjectGroup = 'pinned' | 'projects' | 'archived'

export interface GroupedProjects {
  pinned: Project[]
  projects: Project[]
  archived: Project[]
}

// === Status Filter ===

export type StatusFilter = 'all' | SessionStatus

// === Sessions View Mode ===

export type SessionsViewMode = 'grid' | 'list'

// === Main Panel Tabs ===

/**
 * Tabs scoped to a project context.
 * These represent content views that belong to a project and should
 * be remembered/restored when the user returns from a global view.
 */
export type ProjectTab = 'dashboard' | 'issues' | 'chat' | 'starred' | 'capabilities'

/**
 * Full navigation tab union — includes both project-scoped tabs
 * and global meta-views (schedule).
 *
 * Schedule is semantically a "global meta-view" (not project-scoped),
 * but rendered inside the projects mode layout for UI consistency.
 */
export type MainTab = ProjectTab | 'schedule'

// === Chat Sub-Tabs (Conversation + Sessions inside Chat tab) ===

export type ChatSubTab = 'conversation' | 'sessions'

// === Chat View Mode (Default conversation vs Files+Chat split) ===

export type ChatViewMode = 'default' | 'files'

// === Files View Mode ===

export type FilesDisplayMode = 'ide' | 'browser'

// === File Entry (for Files view) ===

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

export interface FileContentResult {
  content: string
  language: string
  size: number
}

export type FileContentReadResult = FileAccessResult<FileContentResult>
export type FileContentWriteResult = FileAccessResult<{ saved: true }>

export interface ViewToolFileContentInput {
  sessionId: string
  filePath: string
}

export interface ViewCapabilityBundleFileContentInput {
  projectId?: string
  bundle: {
    /** Absolute SKILL.md path that defines the bundle root directory. */
    skillFilePath: string
    /** Path relative to bundle root, e.g. scripts/deploy.sh */
    relativePath: string
  }
}

export interface CapabilitySourceResult {
  content: string
  language: string
}

/** A file entry inside a skill bundle directory (sibling of SKILL.md). */
export interface BundleFileInfo {
  /** Relative path from the bundle root, e.g. "scripts/deploy.sh" */
  relativePath: string
  /** File or directory name */
  name: string
  /** Whether this entry is a directory */
  isDirectory: boolean
  /** File size in bytes (0 for directories) */
  size: number
}

// === Capability Source & Base ===

export type CapabilityScope = 'project' | 'global'

/** Capability origin — where a capability was found */
export type CapabilityOrigin = 'user' | 'plugin' | 'marketplace' | 'project' | 'config-file'

/** Source provenance — tracks where each capability comes from */
export interface CapabilitySource {
  scope: CapabilityScope
  /** Origin type: user directory / plugin cache / marketplace / project directory / config file */
  origin: CapabilityOrigin
  /** Mount provenance info (only when origin='plugin' or 'marketplace') */
  mount?: { name: string; marketplace: string; version: string }
  /** Disk path */
  sourcePath: string
}

/** All Entry types share these fields — eliminates "snowflake interfaces" */
export interface CapabilityEntryBase {
  name: string
  description: string
  source: CapabilitySource
}

// === Capability Entry Types (only differential fields) ===

export interface CommandEntry extends CapabilityEntryBase {
  argumentHint: string
}

// Pure base — no extra fields beyond CapabilityEntryBase
export type SkillEntry = CapabilityEntryBase

export interface AgentEntry extends CapabilityEntryBase {
  model: string
  color: string
}

/** Hook rule — fully models all Claude Code hook type variants */
export interface HookRule {
  type: 'command' | 'prompt' | 'agent'
  command?: string
  prompt?: string
  async?: boolean
}

/** Hook rule group — preserves the ruleGroup structure from settings.json */
export interface HookRuleGroup {
  matcher?: string
  hooks: HookRule[]
  /** true = this group is managed by OpenCow (identified by HOOK_MARKER_KEY) */
  isManagedByApp: boolean
}

export interface HookEventConfig extends CapabilityEntryBase {
  // name = event name (e.g. "PreToolUse", "PostToolUse")
  ruleGroups: HookRuleGroup[]
}

export interface MCPServerEntry extends CapabilityEntryBase {
  serverType: string // renamed from 'type' to avoid TypeScript reserved word conflicts
  author: string
}

export interface RuleEntry extends CapabilityEntryBase {
  ruleType: 'user-rule' | 'project-rule' | 'claude-md'
}

export interface PluginEntry extends CapabilityEntryBase {
  marketplace: string
  version: string
  author: string
  enabled: boolean
  blocked: boolean
  installScope: string
  capabilities: {
    commands: number
    skills: number
    agents: number
    hooks: number
  }
}

export interface LSPServerEntry extends CapabilityEntryBase {
  command: string
  args: string[]
  languages: string[]
}

// === ScopedList + TypeMap + Auto-Derivation ===

/** Generic replacement for the repeated { project: T[]; global: T[] } pattern */
export interface ScopedList<T> {
  project: T[]
  global: T[]
}

/** Category → Entry type compile-time mapping.
 *  Adding a new category = add one line here + derive everything else automatically. */
export interface CapabilityTypeMap {
  command: CommandEntry
  skill: SkillEntry
  agent: AgentEntry
  hook: HookEventConfig
  'mcp-server': MCPServerEntry
  rule: RuleEntry
  plugin: PluginEntry
  'lsp-server': LSPServerEntry
}

/** Auto-derived: union of all category string literals */
export type CapabilityCategory = keyof CapabilityTypeMap

/** Auto-derived: full capabilities collection — zero-cost new category addition */
export type ClaudeCapabilities = {
  [K in CapabilityCategory]: ScopedList<CapabilityTypeMap[K]>
}

// === Capability Identifier ===

export interface CapabilityIdentifier {
  category: CapabilityCategory
  name: string
  source: CapabilitySource
}

// === Managed Capability Identifier (new Capability Center system) ===

/** Identifies a managed capability entry in the Capability Center */
export interface ManagedCapabilityIdentifier {
  category: ManagedCapabilityCategory
  name: string
  scope: 'global' | 'project'
  filePath: string
  projectId?: string
}

// === Detail Context (polymorphic detail panel) ===

export type DetailContext =
  | { type: 'session'; sessionId: string; highlightTurnIndex?: number }
  | { type: 'issue'; issueId: string }
  // Unified capability system (6 managed categories)
  | { type: 'capability'; identifier: ManagedCapabilityIdentifier }
  | { type: 'capability-edit'; identifier: ManagedCapabilityIdentifier }
  | {
      type: 'capability-create'
      category: ManagedCapabilityCategory
      scope: 'global' | 'project'
      projectId?: string
    }
  | { type: 'schedule'; scheduleId: string }
  | { type: 'pipeline'; pipelineId: string }

// === Capability Form Data (per-type payloads) ===

export interface CommandFormData {
  description: string
  argumentHint: string
  body: string
}

export interface AgentFormData {
  description: string
  model: string
  color: string
  body: string
}

export interface SkillFormData {
  description: string
  body: string
}

export interface RuleFormData {
  description: string
  body: string
}

export interface HookRuleFormData {
  type: string
  command: string
  /** Hook event name, e.g. 'PreToolUse' */
  event?: string
  /** Tool matcher, e.g. 'Bash(deploy*)' */
  matcher?: string
}

export interface HookFormData {
  rules: HookRuleFormData[]
}

export interface MCPServerFormData {
  type: string
  command: string
  args: string[]
  env: Record<string, string>
  configFile: '.mcp.json' | '.claude.json'
}

// === MCP Server Template System ===

/** Pre-configured MCP server template with variants and user-facing options. */
export interface MCPServerTemplate {
  id: string
  name: string
  /** Lucide icon name (e.g. 'Globe', 'Wrench') */
  icon: string
  description: string
  serverConfig: {
    type: string
    command: string
    args: string[]
    env?: Record<string, string>
  }
  variants: MCPServerVariant[]
  options: MCPServerOption[]
  tags: string[]
}

/** A configuration variant that overrides the base serverConfig. */
export interface MCPServerVariant {
  id: string
  label: string
  description: string
  serverConfig: Partial<MCPServerTemplate['serverConfig']>
}

/**
 * A user-facing option rendered as a form control.
 * Each option maps to a CLI flag via `argMapping`.
 */
export interface MCPServerOption {
  id: string
  label: string
  description: string
  type: 'boolean' | 'string' | 'select'
  defaultValue: boolean | string
  choices?: string[]
  argMapping: {
    flag: string
    /** When to append the flag. Defaults to 'when-true' for booleans. */
    condition?: 'when-true' | 'when-false'
  }
}

// === Save Params — Discriminated Union (category binds to data type) ===

interface SaveCapabilityBase {
  scope: CapabilityScope
  projectPath?: string
  name: string
}

export type SaveCapabilityParams =
  | (SaveCapabilityBase & { category: 'command'; data: CommandFormData })
  | (SaveCapabilityBase & { category: 'agent'; data: AgentFormData })
  | (SaveCapabilityBase & { category: 'skill'; data: SkillFormData })
  | (SaveCapabilityBase & { category: 'hook'; data: HookFormData })
  | (SaveCapabilityBase & { category: 'mcp-server'; data: MCPServerFormData })

// === Delete Params ===

export interface DeleteCapabilityParams {
  category: CapabilityCategory
  scope: CapabilityScope
  projectPath?: string
  name: string
  sourcePath: string
}

// === CRUD Results ===

export interface SaveCapabilityResult {
  success: boolean
  sourcePath: string
}

export interface DeleteCapabilityResult {
  success: boolean
  trashPath?: string
}

// === Capability Center Types ===

/**
 * The 6 managed capability categories.
 * Document-type: skill, agent, command, rule
 * Config-type: hook, mcp-server
 */
export type ManagedCapabilityCategory = 'skill' | 'agent' | 'command' | 'rule' | 'hook' | 'mcp-server'

/**
 * Authoritative mapping from directory name to capability category.
 * Single source of truth — all modules that need dir→category mapping
 * should derive from this constant rather than maintaining their own copy.
 */
export const DIR_TO_CAPABILITY_CATEGORY: Readonly<Record<string, ManagedCapabilityCategory>> = {
  skills: 'skill',
  commands: 'command',
  agents: 'agent',
  rules: 'rule',
  hooks: 'hook',
  'mcp-servers': 'mcp-server',
}

/**
 * Directories intentionally skipped during marketplace capability discovery,
 * with human-readable reasons. Single source of truth for both API-based
 * probing (githubContent.ts) and local file-based discovery (repoDiscovery.ts).
 */
export const CAPABILITY_SKIP_DIRS: Readonly<Record<string, string>> = {
  hooks: 'Hooks require path resolution (not yet supported)',
  docs: 'Documentation files are not capabilities',
  'mcp-servers': 'MCP servers require explicit configuration',
}

/** Eligibility evaluation result for a capability entry */
export interface CapabilityEligibility {
  eligible: boolean
  /** Reasons for ineligibility (empty array if eligible) */
  reasons: string[]
}

/**
 * Mount provenance info — present for entries from external mount sources
 * (plugins, marketplace packages).
 *
 * Use `sourceOrigin` to distinguish between mount types:
 * - `'claude-code'` → plugin mount
 * - `'marketplace'` → marketplace package mount
 */
export interface CapabilityMountInfo {
  /** Namespace prefix (e.g. "superpowers", "my-plugin") */
  namespace: string
  marketplace: string
  version: string
  /** Origin declared by the mount provider — drives OriginBadge display */
  sourceOrigin: CapabilityImportRecord['sourceOrigin']
}

/** Import provenance record */
export interface CapabilityImportRecord {
  sourcePath: string
  sourceOrigin: 'claude-code' | 'codex' | 'plugin' | 'marketplace' | 'template' | 'file' | 'unknown'
  sourceHash: string | null
  importedAt: number
}

/** Distribution (publish) record — tracks where a capability was published */
export interface CapabilityDistributionInfo {
  targetType: string
  targetPath: string
  strategy: 'copy' | 'symlink'
  contentHash: string
  distributedAt: number
}

/** Document-type capability entry (Skills / Agents / Commands / Rules) */
export interface DocumentCapabilityEntry {
  kind: 'document'
  name: string
  description: string
  body: string
  attributes: Record<string, unknown>
  filePath: string
  category: ManagedCapabilityCategory
  scope: 'global' | 'project'
  projectId?: string
  enabled: boolean
  tags: string[]
  eligibility: CapabilityEligibility
  metadata: Record<string, unknown>
  importInfo?: CapabilityImportRecord | null
  distributionInfo?: CapabilityDistributionInfo | null
  /** All published target types for this capability (e.g. claude+codex). */
  distributionTargets?: string[]
  /** Mount provenance — only set for entries from external mounts (plugins, packages) */
  mountInfo?: CapabilityMountInfo | null
}

/** Config-type capability entry (Hooks / MCP Servers) */
export interface ConfigCapabilityEntry {
  kind: 'config'
  name: string
  description: string
  config: Record<string, unknown>
  filePath: string
  category: ManagedCapabilityCategory
  scope: 'global' | 'project'
  projectId?: string
  enabled: boolean
  tags: string[]
  eligibility: CapabilityEligibility
  metadata: Record<string, unknown>
  importInfo?: CapabilityImportRecord | null
  distributionInfo?: CapabilityDistributionInfo | null
  /** All published target types for this capability (e.g. claude+codex). */
  distributionTargets?: string[]
  /** Mount provenance — only set for entries from external mounts (plugins, packages) */
  mountInfo?: CapabilityMountInfo | null
}

/** Discriminated union: all capability entries */
export type CapabilityEntry = DocumentCapabilityEntry | ConfigCapabilityEntry

/** Full snapshot of all managed capabilities */
export interface CapabilitySnapshot {
  skills: DocumentCapabilityEntry[]
  agents: DocumentCapabilityEntry[]
  commands: DocumentCapabilityEntry[]
  rules: DocumentCapabilityEntry[]
  hooks: ConfigCapabilityEntry[]
  mcpServers: ConfigCapabilityEntry[]
  diagnostics: CapabilityDiagnostic[]
  version: number
  timestamp: number
}

/** Diagnostic info collected during capability discovery */
export interface CapabilityDiagnostic {
  level: 'info' | 'warn' | 'error'
  category: ManagedCapabilityCategory
  name?: string
  message: string
  /** Epoch millis — when the diagnostic was recorded */
  timestamp?: number
}

// === Capability Center IPC Types ===

// === Repo Source Types ===

export type RepoSourcePlatform = 'github' | 'gitlab'
export type RepoSourceSyncStatus = 'idle' | 'syncing' | 'error'

/** UI-visible repo source (credentials never exposed). */
export interface RepoSource {
  id: string
  name: string
  url: string
  /** owner/repo extracted from URL, used as marketplace slug */
  slug: string
  platform: RepoSourcePlatform
  branch: string | null
  hasCredential: boolean
  enabled: boolean
  syncStatus: RepoSourceSyncStatus
  lastSyncedAt: number | null
  lastCommit: string | null
  syncError: string | null
  createdAt: number
  updatedAt: number
}

/** Input for creating a new repo source. */
export interface RepoSourceInput {
  name: string
  url: string
  /** Auto-detected from URL if omitted. */
  platform?: RepoSourcePlatform
  branch?: string
  auth?: {
    method: 'none' | 'pat'
    token?: string
  }
}

/** Input for updating an existing repo source. */
export interface RepoSourceUpdateInput {
  name?: string
  branch?: string
  enabled?: boolean
  auth?: {
    method: 'none' | 'pat'
    token?: string
  }
}

/** Result from browsing a repo source's capabilities. */
export interface RepoSourceBrowseResult {
  capabilities: Array<{ name: string; category: ManagedCapabilityCategory }>
  status: 'ok' | 'degraded' | 'error'
  message?: string
}

// === Skills Marketplace Types ===

/** Marketplace provider identifier */
export type MarketplaceId = 'skills.sh' | 'clawhub' | 'github' | (string & {})

/** Marketplace skill summary (list/search results) */
export interface MarketSkillSummary {
  /** Unique identifier within the marketplace (e.g. "vercel-labs/skills/find-skills") */
  slug: string
  name: string
  description: string
  author: string
  /** Install / download count (not all markets provide this) */
  installs?: number
  /** Star / favorite count (ClawHub, GitHub) */
  stars?: number
  /** Number of published versions (ClawHub) */
  versionCount?: number
  /** Tags / categories */
  tags?: string[]
  /** Source marketplace */
  marketplaceId: MarketplaceId
  /** Version string (if available) */
  version?: string
  /** Last updated ISO timestamp */
  updatedAt?: string
  /** Source repository URL */
  repoUrl?: string
}

/** Marketplace skill detail (preview page) */
export interface MarketSkillDetail extends MarketSkillSummary {
  /** Full SKILL.md content */
  content: string
  /** Parsed frontmatter attributes */
  attributes: Record<string, unknown>
  /** Additional files in the skill bundle */
  files?: Array<{ path: string; type: 'script' | 'reference' | 'asset' }>
  /** License */
  license?: string
  /** Compatibility notes */
  compatibility?: string
  /** README or additional description */
  readme?: string
}

/** Marketplace search parameters */
export interface MarketSearchParams {
  query: string
  limit?: number
  offset?: number
  sortBy?: 'relevance' | 'installs' | 'updated' | 'name'
  /** Filter by marketplace */
  marketplaceId?: MarketplaceId
}

/** Marketplace search result (per-provider) */
export interface MarketSearchResult {
  items: MarketSkillSummary[]
  total: number
  hasMore: boolean
}

// ─── Grouped search results ────────────────────────────────

/** Status of a single marketplace provider during search */
export type MarketProviderStatus =
  | { state: 'loading' }
  | { state: 'ok' }
  | { state: 'needs-key'; message: string }
  | { state: 'rate-limited'; retryAfter?: number }
  | { state: 'error'; message: string }

/** A single marketplace's search group (status + results) */
export interface MarketSearchGroup {
  marketplaceId: MarketplaceId
  displayName: string
  status: MarketProviderStatus
  results: MarketSkillSummary[]
  total: number
  hasMore: boolean
}

/** Aggregated search result across all marketplaces */
export type MarketGroupedSearchResult = MarketSearchGroup[]

/** Marketplace browse parameters */
export interface MarketBrowseParams {
  mode: 'trending' | 'popular' | 'recent' | 'featured'
  limit?: number
  offset?: number
  marketplaceId: MarketplaceId
}

/** Install preview — lightweight capability analysis before actual install. */
export interface MarketInstallPreview {
  /** Whether the repo contains multiple structured capability directories. */
  isMultiCapability: boolean
  /** Discovered capabilities grouped by category. */
  capabilities: Array<{
    name: string
    category: ManagedCapabilityCategory
  }>
  /** Directories that were skipped, with reasons. */
  skipped: Array<{ dir: string; reason: string }>
  /**
   * Probe status: distinguishes "confident result" from "degraded fallback".
   *
   * - `'ok'`       — probe completed successfully, capabilities list is accurate.
   * - `'degraded'` — probe failed (e.g. rate limit, network error); capabilities
   *                   list is a best-effort fallback and may be incomplete.
   */
  probeStatus: 'ok' | 'degraded'
  /** Human-readable reason when probeStatus is 'degraded'. */
  probeMessage?: string
}

/** Marketplace install result */
export interface MarketInstallResult {
  success: boolean
  installedPath: string
  name: string
  version?: string
  marketplaceId: MarketplaceId
  sourceSlug: string
  /** Multi-capability: number of individual capabilities imported */
  importedCount?: number
  /** Multi-capability: names of successfully imported capabilities */
  importedNames?: string[]
}

/** Installed package info — renderer-facing summary of a DB-tracked package. */
/**
 * Installed package info exposed to the renderer via IPC.
 *
 * Intentionally omits internal fields (DB id, contentHash) — those are
 * managed by PackageService/PackageRegistry and have no UI relevance.
 */
export interface InstalledPackageInfo {
  /** Namespace prefix (e.g. "superpowers") */
  prefix: string
  scope: 'global' | 'project'
  projectId: string
  marketplaceId: MarketplaceId
  slug: string
  version: string
  repoUrl: string
  author: string
  /** Capabilities discovered at install time */
  capabilities: Partial<Record<ManagedCapabilityCategory, string[]>>
  installedAt: number
  updatedAt: number
}

/** Marketplace provider descriptor (for UI listing) */
export interface MarketProviderInfo {
  id: MarketplaceId
  displayName: string
  icon: string
  url: string
  available: boolean
}

/** Marketplace origin metadata attached to imported items */
export interface MarketSkillInfo {
  marketplaceId: MarketplaceId
  slug: string
  version?: string
  repoUrl?: string
  author?: string
  installs?: number
}

/** Import source types for Capability Center IPC */
export type CapabilityImportSourceType =
  | 'claude-code'
  | 'codex'
  | 'plugin'
  | 'marketplace'
  | 'template'
  | 'file'

/** Discriminated union — each sourceType carries only its own required params */
export type CapabilityDiscoverParams =
  | { sourceType: 'claude-code'; projectId?: string }
  | { sourceType: 'codex'; projectId?: string }
  | { sourceType: 'plugin' }
  | { sourceType: 'template' }
  | { sourceType: 'marketplace'; query?: string; marketplaceId?: string }
  | { sourceType: 'file'; filePaths: string[]; projectId?: string }

/** Importable item description (IPC-serializable) */
export interface CapabilityImportableItem {
  name: string
  category: ManagedCapabilityCategory
  description: string
  sourcePath: string
  sourceType: CapabilityImportSourceType
  alreadyImported: boolean
  /** Where the item was discovered: global (~/.claude) or project ({project}/.claude) */
  sourceScope: 'global' | 'project'
  /** For skills: true = bundle (directory with SKILL.md + assets), false/undefined = flat .md file */
  isBundle?: boolean
  /** Marketplace origin metadata — only present when sourceType === 'marketplace' */
  marketInfo?: MarketSkillInfo
}

/** Import result (IPC-serializable) */
export interface CapabilityImportResult {
  imported: string[]
  skipped: string[]
  errors: Array<{ name: string; error: string }>
}

// === Capability Center Distribution IPC Types ===

/** Raw content save — caller handles serialization */
export interface CapabilitySaveParams {
  scope: 'global' | 'project'
  category: ManagedCapabilityCategory
  name: string
  content: string
  projectId?: string
}

/** Structured form-data save — backend handles serialization (v3.1 #9) */
interface CapabilitySaveFormBase {
  scope: 'global' | 'project'
  name: string
  projectId?: string
}

export type CapabilitySaveFormParams =
  | (CapabilitySaveFormBase & { category: 'skill'; data: SkillFormData })
  | (CapabilitySaveFormBase & { category: 'agent'; data: AgentFormData })
  | (CapabilitySaveFormBase & { category: 'command'; data: CommandFormData })
  | (CapabilitySaveFormBase & { category: 'rule'; data: RuleFormData })
  | (CapabilitySaveFormBase & { category: 'hook'; data: HookFormData })
  | (CapabilitySaveFormBase & { category: 'mcp-server'; data: MCPServerFormData })

export interface CapabilityToggleParams {
  scope: 'global' | 'project'
  category: ManagedCapabilityCategory
  name: string
  enabled: boolean
  projectId?: string
}

export interface CapabilityPublishParams {
  category: ManagedCapabilityCategory
  name: string
  target: 'claude-code-global' | 'claude-code-project' | 'codex-global' | 'codex-project'
  projectId?: string
}

export interface CapabilityDriftReport {
  category: ManagedCapabilityCategory
  name: string
  targetPath: string
  reason: string
  staleHash: string
  currentHash: string
}

// === Capability Clone (Cross-Project Copy) ===

/** Parameters for discovering clonable capabilities from a source project. */
export interface DiscoverClonableParams {
  sourceProjectId: string
  targetProjectId: string
}

/** A capability that can be cloned from the source project. */
export interface ClonableCapability {
  name: string
  category: ManagedCapabilityCategory
  description: string
  /** Non-null when a same-name capability already exists in the target project. */
  conflict: CloneConflictInfo | null
}

/** Conflict metadata for a clonable capability. */
export interface CloneConflictInfo {
  existingName: string
  existingCategory: ManagedCapabilityCategory
}

/** How to handle a naming conflict during clone. */
export type CloneConflictResolution = 'skip' | 'overwrite' | 'rename'

/** A single item the user selected for cloning (with optional conflict strategy). */
export interface CloneItemSelection {
  name: string
  category: ManagedCapabilityCategory
  /** Required when the item has a conflict; ignored otherwise. */
  conflictResolution?: CloneConflictResolution
}

/** Parameters for executing a clone operation. */
export interface CloneCapabilitiesParams {
  sourceProjectId: string
  targetProjectId: string
  items: CloneItemSelection[]
}

/** Discriminated-union result for a single cloned item. */
export type CloneResultItem =
  | { outcome: 'created'; name: string; category: ManagedCapabilityCategory }
  | { outcome: 'overwritten'; name: string; category: ManagedCapabilityCategory }
  | { outcome: 'renamed'; originalName: string; newName: string; category: ManagedCapabilityCategory }
  | { outcome: 'skipped'; name: string; category: ManagedCapabilityCategory }
  | { outcome: 'failed'; name: string; category: ManagedCapabilityCategory; error: string }

/** Aggregated result of a clone operation. */
export interface CloneResult {
  items: CloneResultItem[]
  summary: {
    succeeded: number
    skipped: number
    failed: number
  }
}

// === Stats ===

export interface StatsSnapshot {
  todayCostUSD: number
  todayTokens: number
  todaySessions: number
  todayToolCalls: number
  totalSessions: number
  totalMessages: number
}

// === Task (extended for full task data from ~/.claude/tasks/) ===

export interface TaskFull {
  id: string
  subject: string
  description: string
  activeForm: string
  status: 'pending' | 'in_progress' | 'completed'
  blocks: string[]
  blockedBy: string[]
}

export interface TaskGroup {
  status: TaskFull['status']
  label: string
  tasks: TaskFull[]
}

// === Onboarding ===

export interface OnboardingState {
  completed: boolean
  hooksInstalled: boolean
}

// === Prerequisite Checks ===

export interface PrerequisiteItem {
  name: string // e.g. "Node.js", "Claude Code CLI"
  required: boolean // true = blocks onboarding, false = optional
  satisfied: boolean // true = check passed
  version: string | null // detected version string, null if not found
  hint: string // guidance when not satisfied
}

export interface PrerequisiteCheckResult {
  /** All required items are satisfied */
  canProceed: boolean
  items: PrerequisiteItem[]
}

// === Project Discovery ===

/** A discovered but not-yet-imported project candidate shown during onboarding import. */
export interface DiscoveredProjectCandidate {
  folderName: string // Directory name under ~/.claude/projects/
  resolvedPath: string // Resolved absolute project path
  name: string // Display name (typically basename of resolvedPath)
  sessionCount: number // Number of session files discovered
}

// ─── Terminal Types ────────────────────────────────────────────────

/** Ownership identifier for a Terminal instance.
 *
 *  Discriminated Union, following the same pattern as BrowserSource.
 *  Each scope can own multiple active PTY instances (multiple tabs).
 */
export type TerminalScope = { type: 'project'; projectId: string } | { type: 'global' }

/** Terminal spawn request parameters */
export interface TerminalSpawnParams {
  scope: TerminalScope
  cols: number
  rows: number
}

/** Runtime snapshot of a Terminal instance (used for IPC transport) */
export interface TerminalInfo {
  id: string
  scope: TerminalScope
  pid: number
  cwd: string
  shell: string
  createdAt: number
}

/** Terminal exit event payload */
export interface TerminalExitPayload {
  id: string
  exitCode: number
  signal?: number
}

// ─── Terminal Overlay State ───────────────────────────────────────

/** State while the TerminalSheet is open.
 *
 *  Contains only the panel toggle state and the current scope.
 *  Tab data is managed independently by TerminalTabGroup.
 */
export interface TerminalOverlayState {
  /** Currently displayed terminal scope */
  scope: TerminalScope
}

// ─── Terminal Tab Types ──────────────────────────────────────────

/** A single terminal tab (maps to one PTY instance) */
export interface TerminalTab {
  terminalId: string
  /** Display name (shell basename, e.g. "zsh", "bash") */
  displayName: string
}

/** Collection of all terminal tabs within a single scope */
export interface TerminalTabGroup {
  tabs: TerminalTab[]
  /** Currently active tab ID */
  activeTabId: string
}

// === Marketplace Analysis Constants & Types ===

/**
 * Hard timeout for Agent analysis (seconds).
 *
 * Shared across backend (RepoAnalyzer) and renderer (InstallDialog timeout warning).
 * Single source of truth — never duplicate this value.
 */
export const MARKET_ANALYSIS_TIMEOUT_SEC = 300 // 5 minutes

/**
 * Full lifecycle phases for marketplace Agent analysis.
 *
 * Canonical type — imported by backend (agentAnalyzer), IPC (DataBusEvent), and renderer hooks.
 * Adding a new phase here will trigger TypeScript errors in all consumers automatically.
 *
 * Phase flow:
 *   downloading → agent:started → agent:reading-files → agent:analyzing
 *   → agent:submitting → agent:done → validating
 *   (cancelled can occur at any point)
 */
export type MarketAnalysisPhase =
  | 'downloading'
  | 'agent:started'
  | 'agent:reading-files'
  | 'agent:analyzing'
  | 'agent:submitting'
  | 'agent:done'
  | 'validating'
  | 'cancelled'

// === DataBus Events ===

export type DataBusEvent =
  | {
      type: 'sessions:updated'
      payload: { projects: Project[]; sessions: Session[] }
    }
  | { type: 'sessions:detail'; payload: { sessionId: string; content: SessionContent } }
  | { type: 'tasks:updated'; payload: { sessionId: string; tasks: TaskFull[] } }
  | { type: 'stats:updated'; payload: StatsSnapshot }
  | { type: 'hooks:event'; payload: HookEvent }
  | { type: 'onboarding:status'; payload: OnboardingState }
  | { type: 'inbox:updated'; payload: { messages: InboxMessage[]; unreadCount: number } }
  | { type: 'capabilities:updated'; payload: Record<string, never> }
  | { type: 'capabilities:changed'; payload: Record<string, never> }
  | { type: 'capabilities:drift'; payload: { drifts: CapabilityDriftReport[] } }
  // Command Phase events
  | { type: 'command:session:created'; payload: SessionSnapshot }
  | { type: 'command:session:updated'; payload: SessionSnapshot }
  | {
      type: 'command:session:message'
      payload: {
        sessionId: string
        origin: SessionOrigin
        message: ManagedSessionMessage
        /**
         * When true, this dispatch is a relay progress update (e.g. Evose tool
         * execution progress) intended only for the renderer's progress card.
         * Telegram and other external push channels should skip these events.
         */
        isRelayProgress?: boolean
      }
    }
  | {
      type: 'command:session:idle'
      payload: {
        sessionId: string
        origin: SessionOrigin
        stopReason: SessionStopReason
        result?: string
        costUsd?: number
      }
    }
  | {
      type: 'command:session:stopped'
      payload: {
        sessionId: string
        origin: SessionOrigin
        stopReason: SessionStopReason
        result?: string
        costUsd?: number
      }
    }
  | {
      type: 'command:session:error'
      payload: { sessionId: string; origin: SessionOrigin; error: string }
    }
  | { type: 'command:session:deleted'; payload: { sessionId: string } }
  | {
      type: 'command:session:ask-question'
      payload: {
        sessionId: string
        requestId: string
        /** Question data passed to the UI for rendering the interactive card */
        questions: unknown
      }
    }
  // Settings
  | { type: 'settings:updated'; payload: AppSettings }
  // Auth
  | { type: 'provider:status'; payload: ProviderStatus }
  // Marketplace analysis progress (Agent-First install)
  | {
      type: 'market:analyze:progress'
      payload: {
        /** Marketplace slug being analyzed */
        slug: string
        /** Current analysis phase (canonical type — see MarketAnalysisPhase) */
        phase: MarketAnalysisPhase
        /** Human-readable description */
        detail?: string
        /** Tool name when the Agent is using a tool */
        toolName?: string
        /** Error category when phase is terminal failure (timeout, network, auth, sdk-error, unknown) */
        errorKind?: string
      }
    }
  | {
      type: 'market:analysis:complete'
      payload: {
        sessionId: string
        slug: string
        marketplaceId: string
        /** Preview data — null if Agent found no capabilities */
        preview: MarketInstallPreview | null
        /** Error message if analysis failed */
        error?: string
      }
    }
  // Artifacts
  | { type: 'artifacts:changed'; payload: { sessionId: string; count: number } }
  | { type: 'artifacts:starred'; payload: { artifactId: string; starred: boolean } }
  // Browser
  | {
      type: 'browser:view:opened'
      payload: { viewId: string; profileId: string; profileName: string }
    }
  | { type: 'browser:view:closed'; payload: { viewId: string } }
  | { type: 'browser:navigated'; payload: { viewId: string; url: string; title: string } }
  | { type: 'browser:loading'; payload: { viewId: string; isLoading: boolean } }
  | { type: 'browser:thumbnail-updated'; payload: { viewId: string; dataUrl: string } }
  | {
      type: 'browser:executor:state-changed'
      payload: { viewId: string; state: BrowserExecutorState }
    }
  | { type: 'browser:context'; payload: BrowserShowContext }
  // Browser command lifecycle (visual decorator feedback)
  | { type: 'browser:command:started'; payload: { viewId: string; action: string } }
  | {
      type: 'browser:command:completed'
      payload: { viewId: string; action: string; success: boolean }
    }
  // Browser overlay lifecycle (renderer-side)
  | {
      type: 'browser:open-overlay'
      payload: { source: BrowserSource; options?: BrowserOpenOptions }
    }
  | { type: 'browser:close-overlay'; payload: Record<string, never> }
  // Messaging — unified IM connection status
  | { type: 'messaging:status'; payload: IMConnectionStatus }
  // Messaging — WeChat QR code login events (Main → Renderer)
  | { type: 'messaging:weixin-qr-ready'; payload: { connectionId: string; qrcodeImageContent: string } }
  | { type: 'messaging:weixin-qr-scanned'; payload: { connectionId: string } }
  | { type: 'messaging:weixin-qr-login-success'; payload: { connectionId: string } }
  | { type: 'messaging:weixin-qr-login-failed'; payload: { connectionId: string; error: string } }
  // Tray Popover → Main Window navigation (issue-centric)
  | { type: 'tray:navigate-issue'; payload: { issueId: string; projectId: string } }
  // Tray Popover data push (main process → tray popover renderer)
  | { type: 'tray:issues-updated'; payload: { items: TrayIssueItem[] } }
  // Schedule events
  | { type: 'schedule:created'; payload: { schedule: Schedule } }
  | { type: 'schedule:updated'; payload: { schedule: Schedule } }
  | { type: 'schedule:deleted'; payload: { scheduleId: string } }
  | { type: 'schedule:executing'; payload: { scheduleId: string; executionId: string } }
  | { type: 'schedule:executed'; payload: { scheduleId: string; execution: ScheduleExecution } }
  | { type: 'schedule:paused'; payload: { scheduleId: string; reason: string } }
  // Issue events — emitted by IssueService on every mutation so the
  // renderer can reactively refresh the list (consistent with Schedule/Session patterns).
  | { type: 'issues:invalidated'; payload: Record<string, never> }
  // Issue status change (needed by Schedule EventMatcher)
  | {
      type: 'issue:status_changed'
      payload: { issueId: string; oldStatus: IssueStatus; newStatus: IssueStatus }
    }
  // Project path changed (triggers dependent subsystems to migrate stale path references)
  | {
      type: 'project:path-changed'
      payload: { projectId: string; oldPath: string; newPath: string }
    }
  // Project import completion signal (consumed by runtime automation listeners)
  | { type: 'projects:import-completed'; payload: Record<string, never> }
  // Pipeline events
  | {
      type: 'pipeline:step:completed'
      payload: { pipelineId: string; stepOrder: number; status: ExecutionStatus }
    }
  // Terminal
  | { type: 'terminal:exited'; payload: TerminalExitPayload }
  // Git integration
  | {
      type: 'git:status-changed'
      payload: { projectPath: string; snapshot: GitRepositorySnapshot }
    }
  | {
      type: 'git:status-cleared'
      payload: { projectPath: string }
    }
  // Package lifecycle events (emitted by PackageService on install/uninstall)
  | { type: 'package:installed'; payload: { prefix: string; scope: string } }
  | { type: 'package:uninstalled'; payload: { prefix: string; scope: string } }
  // Update checker
  | { type: 'update:check-result'; payload: UpdateCheckResult }
  // UI-only events (main → renderer, not persisted in DataBus)
  | { type: 'ui:toast'; payload: { message: string; duration?: number } }
  | { type: 'menu:about' }

// === DataBus AppState ===

export interface AppStateMain {
  projects: Project[]
  sessions: Session[]
  tasks: Map<string, TaskFull[]>
  stats: StatsSnapshot | null
  hookEvents: HookEvent[]
  onboarding: OnboardingState
  inboxMessages: InboxMessage[]
  inboxUnreadCount: number
  settings: AppSettings | null
  providerStatus: ProviderStatus | null
}

// === Inbox Types ===

export type InboxMessageStatus = 'unread' | 'read' | 'archived'

export type HookEventType =
  | 'session_start'
  | 'session_stop'
  | 'session_end'
  | 'session_error'
  | 'task_completed'
  | 'notification'
  | 'subagent_start'
  | 'subagent_stop'

export type SmartReminderType = 'idle_session' | 'error_spike' | 'daily_summary'

export type InboxPriority = 'high' | 'normal' | 'low'

// === Hook Event Typed Payloads ===

interface HookPayloadBase {
  session_id?: string
  cwd?: string
  hook_event_name?: string
  transcript_path?: string
  permission_mode?: string
}

export interface SessionStartPayload extends HookPayloadBase {
  source?: 'startup' | 'resume' | 'clear' | 'compact'
  model?: string
  agent_type?: string
}

export interface SessionStopPayload extends HookPayloadBase {
  stop_hook_active?: boolean
  last_assistant_message?: string
}

export interface TaskCompletedPayload extends HookPayloadBase {
  task_id?: string
  task_subject?: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

export interface NotificationPayload extends HookPayloadBase {
  title?: string
  message?: string
  notification_type?: string
}

export interface SessionErrorPayload extends HookPayloadBase {
  tool_name?: string
  tool_input?: Record<string, unknown>
  error?: string
}

export interface InboxMessageBase {
  id: string
  status: InboxMessageStatus
  createdAt: number
  readAt?: number
  archivedAt?: number
}

/**
 * Canonical navigation destination attached to each hook-event inbox message.
 * Generated in main process during classification and persisted with the message.
 */
export type InboxNavigationTarget =
  | { kind: 'issue'; projectId: string; issueId: string }
  | { kind: 'session'; projectId: string; sessionId: string }
  | { kind: 'schedule'; scheduleId: string }

export interface HookEventMessage extends InboxMessageBase {
  category: 'hook_event'
  eventType: HookEventType
  projectId: string | null
  sessionId: string
  navigationTarget: InboxNavigationTarget
  rawPayload: Record<string, unknown>
}

export interface IdleSessionContext {
  sessionId: string
  idleDurationMs: number
  lastActivity: number
}

export interface ErrorSpikeContext {
  projectId: string
  errorCount: number
  windowMs: number
}

export interface DailySummaryContext {
  date: string
  sessionsCompleted: number
  tasksCompleted: number
  totalCostUSD: number
}

export type SmartReminderContext = IdleSessionContext | ErrorSpikeContext | DailySummaryContext

export interface SmartReminderMessage extends InboxMessageBase {
  category: 'smart_reminder'
  reminderType: SmartReminderType
  context: SmartReminderContext
}

export type InboxMessage = HookEventMessage | SmartReminderMessage

export interface InboxFilter {
  category?: InboxMessage['category']
  status?: InboxMessageStatus
  search?: string
  projectId?: string
}

export interface InboxStats {
  unreadCount: number
  total: number
}

// === App View ===

export type AppView =
  | { mode: 'projects'; tab: MainTab; projectId: string | null }
  | { mode: 'inbox'; selectedMessageId: string | null }

// === Tray Popover ===

/** Session activity status visible in the tray — excludes 'completed' (not actionable). */
export type TraySessionStatus = 'active' | 'waiting' | 'error'

/**
 * Issue-centric view model for the Tray Popover.
 *
 * Computed in the main process by joining managed sessions (for activity status)
 * with issues (for user-facing metadata). The tray popover only renders this
 * pre-computed data — no cross-entity joins happen in the renderer.
 */
export interface TrayIssueItem {
  issueId: string
  issueTitle: string
  issueStatus: IssueStatus
  issuePriority: IssuePriority
  projectId: string
  projectName: string | null
  /** Activity status of the managed session linked to this issue. */
  sessionStatus: TraySessionStatus
  /** Managed session ID (ccb-*) — used for IPC actions like stop/resume. */
  managedSessionId: string
  lastActivity: number
}

// === Issues ===

export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low'

export type IssueStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled'

/** Image attachment stored inline with an Issue. */
// ─── Issue Context Refs ──────────────────────────────────────────────────

export type ContextRefType = 'issue' | 'artifact'

export interface ContextRef {
  type: ContextRefType
  id: string
}

/** Filter for the `get-context-candidates` IPC call. */
export interface ContextCandidateFilter {
  /** When set, only return issues belonging to this project. */
  projectId?: string
}

export interface IssueImage {
  id: string
  mediaType: string // "image/png", "image/jpeg", etc.
  data: string // base64-encoded (no data URI prefix)
  sizeBytes: number
}

export interface Issue {
  id: string
  title: string
  description: string
  /** TipTap document JSON for rich description with slash command nodes. Null for plain-text-only issues. */
  richContent: string | null
  status: IssueStatus
  priority: IssuePriority
  labels: string[]
  projectId: string | null
  sessionId: string | null
  /** Historical session IDs replaced by "New Session" (most-recent last). */
  sessionHistory: string[]
  parentIssueId: string | null
  images: IssueImage[]
  createdAt: number
  updatedAt: number
  /** Timestamp of when the user last viewed this issue (null = never viewed). */
  readAt: number | null
  /** Timestamp of the last agent-completed activity on this issue (null = no agent activity). */
  lastAgentActivityAt: number | null
  contextRefs: ContextRef[]
}

/**
 * Lightweight issue representation for list views.
 *
 * Excludes heavy fields that are only needed in detail/edit contexts:
 * - `description` — large text, only rendered in IssueDetailView
 * - `richContent` — TipTap JSON, only needed in edit/prompt-build contexts
 * - `images` — base64-encoded data, primary contributor to DB size
 * - `sessionHistory` — historical session IDs, only used in detail actions
 * - `contextRefs` — loaded via separate table join, only rendered in detail view
 */
export type IssueSummary = Omit<Issue, 'description' | 'richContent' | 'images' | 'sessionHistory' | 'contextRefs'>

/**
 * Determine whether an issue has unread agent activity.
 *
 * An issue is "unread" when:
 * - The user manually marked it as unread (`readAt === 0`), OR
 * - The agent has completed work on it (`lastAgentActivityAt` is set)
 *   and the user hasn't viewed the issue since that activity occurred.
 *
 * Accepts any object with `readAt` and `lastAgentActivityAt` — works with
 * both full `Issue` and lightweight `IssueSummary`.
 */
export function isIssueUnread(issue: Pick<Issue, 'readAt' | 'lastAgentActivityAt'>): boolean {
  // readAt === 0 is a sentinel value meaning "manually marked as unread"
  if (issue.readAt === 0) return true
  if (issue.lastAgentActivityAt === null) return false
  return issue.readAt === null || issue.lastAgentActivityAt > issue.readAt
}

export interface IssuesStoreData {
  version: 1
  issues: Issue[]
  customLabels: string[]
}

export interface CreateIssueInput {
  title: string
  description?: string
  /** TipTap document JSON. When provided, `description` is auto-derived by the service layer. */
  richContent?: string
  status?: IssueStatus
  priority?: IssuePriority
  labels?: string[]
  projectId?: string | null
  sessionId?: string | null
  parentIssueId?: string | null
  images?: IssueImage[]
  contextRefs?: ContextRef[]
}

/**
 * Allowed fields for updating an existing issue.
 *
 * Excludes identity (`id`) and server-managed timestamps (`createdAt`,
 * `updatedAt`) — these are immutable after creation.  `readAt` has a
 * dedicated mutation path (`markIssueRead`/`markIssueUnread`) but is
 * included here because it's part of the same DB row and the IPC handler
 * accepts it.
 */
export type UpdateIssueInput = Partial<Omit<Issue, 'id' | 'createdAt' | 'updatedAt'>>

export interface IssueFilter {
  status?: IssueStatus
  priority?: IssuePriority
  label?: string
  projectId?: string
  search?: string
  parentIssueId?: string | null
}

// === View System Types ===

export type RelativeTime = 'today' | 'this_week' | 'this_month' | 'last_7d' | 'last_30d'

export type TimeFilter =
  | { type: 'relative'; value: RelativeTime }
  | { type: 'absolute'; after: number; before?: number }

export interface SessionFilter {
  exists?: boolean
  states?: ManagedSessionState[]
}

export type GroupByField = 'status' | 'priority' | 'label' | 'project'

export interface SortConfig {
  field: 'priority' | 'createdAt' | 'updatedAt' | 'status'
  order: 'asc' | 'desc'
}

export interface ViewFilters {
  statuses?: IssueStatus[]
  priorities?: IssuePriority[]
  labels?: string[]
  projectId?: string
  created?: TimeFilter
  updated?: TimeFilter
  session?: SessionFilter
}

export interface ViewDisplayConfig {
  groupBy: GroupByField | null
  sort: SortConfig
}

export interface IssueView {
  id: string
  name: string
  icon: string
  filters: ViewFilters
  display: ViewDisplayConfig
  position: number
  createdAt: number
  updatedAt: number
}

export const ALL_VIEW: IssueView = {
  id: '__all__',
  name: 'All',
  icon: '',
  filters: {},
  display: { groupBy: null, sort: { field: 'updatedAt', order: 'desc' } },
  position: -1,
  createdAt: 0,
  updatedAt: 0
}

export interface EphemeralFilters {
  statuses?: IssueStatus[]
  priorities?: IssuePriority[]
  labels?: string[]
  search?: string
}

export interface IssueQueryFilter {
  statuses?: IssueStatus[]
  priorities?: IssuePriority[]
  labels?: string[]
  projectId?: string
  search?: string
  parentIssueId?: string | null
  /** Optional exact-match session IDs for Issue↔Session link lookups. */
  sessionIds?: string[]
  createdAfter?: number
  createdBefore?: number
  updatedAfter?: number
  updatedBefore?: number
  hasSession?: boolean
  sessionStates?: ManagedSessionState[]
  sort?: SortConfig
}

export interface CreateIssueViewInput {
  name: string
  icon: string
  filters: ViewFilters
  display: ViewDisplayConfig
}

export type UpdateIssueViewInput = Partial<CreateIssueViewInput>

// === Attachment Constants ===

export const ATTACHMENT_LIMITS = {
  image: {
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB
    supportedTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const,
  },
  document: {
    maxSizeBytes: 25 * 1024 * 1024, // 25 MB (API limit 32 MB, reserve headroom for base64 inflation)
    supportedTypes: ['application/pdf', 'text/plain'] as const,
  },
  /** Total attachments (images + documents) per message. */
  maxPerMessage: 5,
} as const

export type ImageMediaType = (typeof ATTACHMENT_LIMITS.image.supportedTypes)[number]
export type DocumentMediaType = (typeof ATTACHMENT_LIMITS.document.supportedTypes)[number]
export type AttachmentMediaType = ImageMediaType | DocumentMediaType

export const NOTE_IMAGE_MAX_COUNT = 3 // max images per note

/** Content payload for user messages sent via IPC (text-only string or mixed blocks). */
export type UserMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; mediaType: string; data: string; sizeBytes: number }
      | { type: 'document'; mediaType: string; data: string; sizeBytes: number; title: string }
      | {
          type: 'slash_command'
          name: string
          category: 'command' | 'skill'
          label: string
          execution?: SlashCommandExecutionContract
          expandedText: string
        }
    >

// === Content Blocks (Session Console) ===

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | SlashCommandBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  mediaType: ImageMediaType
  data: string // base64-encoded (no data URI prefix)
  sizeBytes: number
  /** If extracted from a tool_result, the originating toolUseId for context-aware rendering. */
  toolUseId?: string
}

export interface DocumentBlock {
  type: 'document'
  mediaType: DocumentMediaType
  data: string // PDF: base64-encoded; text/plain: raw text content
  sizeBytes: number
  title: string // original filename for display
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
  /** Plain-text progress for SDK native tools (Bash, Task, etc.) */
  progress?: string
  /** Structured progress blocks for Evose Agent tool calls */
  progressBlocks?: EvoseProgressBlock[]
}

// ─── Evose Progress Blocks ──────────────────────────────────────────────────
//
// Evose Agent progress is not a single Markdown string but a sequence of typed event blocks.
// Analogous to ContentBlock[]: messages in the Session Console are composed of TextBlock /
// ToolUseBlock etc.; Evose progress follows the same pattern with EvoseTextBlock /
// EvoseToolCallBlock.
//
// Data remains structured end-to-end (SSE -> AgentRunEvent -> Relay -> ManagedSession -> UI),
// with zero serialization and zero parsing.

/** Evose Agent progress content block -- structured event stream */
export type EvoseProgressBlock = EvoseTextBlock | EvoseToolCallBlock

/** Evose Agent text output block */
export interface EvoseTextBlock {
  type: 'text'
  text: string
}

/** Evose Agent sub-tool call block -- full lifecycle */
export interface EvoseToolCallBlock {
  type: 'tool_call'
  toolCallId: string
  toolName: string
  title: string
  status: 'running' | 'completed' | 'error'
  iconUrl?: string
  kwargs?: Record<string, unknown>
  result?: string
}

/**
 * Evose Relay event -- typed messages from evoseCapability -> relay -> ManagedSession.
 *
 * Each SSE event maps to a typed relay event; ManagedSession uses these to maintain progressBlocks[].
 */
export type EvoseRelayEvent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call_started'
      toolCallId: string
      toolName: string
      title: string
      iconUrl?: string
      kwargs?: Record<string, unknown>
    }
  | {
      type: 'tool_call_completed'
      toolCallId: string
      toolName: string
      title: string
      result: string
      isError: boolean
    }

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: string
  isError?: boolean
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export type SlashCommandProviderExecution =
  | {
      provider: 'evose'
      appId: string
      appType: 'agent' | 'workflow'
      gatewayTool: 'evose_run_agent' | 'evose_run_workflow'
    }

export interface SlashCommandExecutionContract {
  /**
   * Native capabilities required by this slash command at runtime.
   * Empty array means no native requirements.
   */
  nativeRequirements: StartSessionNativeToolAllowItem[]
  /**
   * Optional provider-specific execution payload.
   * Used for explicit app-level execution routing/telemetry.
   */
  providerExecution?: SlashCommandProviderExecution
}

export interface SlashCommandBlock {
  type: 'slash_command'
  name: string
  category: 'command' | 'skill'
  /** Frozen display label captured at send-time. */
  label: string
  execution?: SlashCommandExecutionContract
  expandedText: string
}

// === System Events (Session Console inline events) ===

export interface TaskStartedEvent {
  type: 'task_started'
  taskId: string
  toolUseId?: string
  description: string
  /** Sub-agent type reported by SDK (e.g. "Explore", "Bash", "Plan"). */
  taskType?: string
}

export interface TaskNotificationEvent {
  type: 'task_notification'
  taskId: string
  toolUseId?: string
  status: 'completed' | 'failed' | 'stopped'
  summary: string
  /** Path to the sub-agent's output file (reported by SDK). */
  outputFile?: string
  usage?: {
    totalTokens: number
    toolUses: number
    durationMs: number
  }
}

export interface HookStatusEvent {
  type: 'hook'
  hookId: string
  hookName: string
  hookTrigger: string
  outcome?: 'success' | 'error' | 'cancelled'
  exitCode?: number
  output?: string
}

export interface CompactBoundaryEvent {
  type: 'compact_boundary'
  trigger: 'manual' | 'auto'
  preTokens: number
  /** Phase of the compact operation: 'compacting' while in progress, 'done' when finished.
   *  Legacy events without phase are treated as 'done'. */
  phase?: 'compacting' | 'done'
}

export type SystemEvent =
  | TaskStartedEvent
  | TaskNotificationEvent
  | HookStatusEvent
  | CompactBoundaryEvent

// === Command Phase: Managed Sessions ===

export type ManagedSessionState =
  | 'creating' // subprocess spawning (~4.8s first time)
  | 'streaming' // Agent is outputting
  | 'awaiting_input' // Agent finished, waiting for next user message
  | 'awaiting_question' // MCP ask_user_question tool is blocking, waiting for user answer
  | 'idle' // SDK query() ended, can resume via SDK resume option
  | 'stopping' // graceful shutdown in progress
  | 'stopped' // subprocess exited (can be resumed)
  | 'error' // unrecoverable error

export type SessionStopReason =
  | 'completed' // Agent naturally completed (result.subtype === 'success')
  | 'max_turns' // maxTurns limit (result.subtype === 'error_max_turns')
  | 'user_stopped' // user clicked Stop
  | 'budget_exceeded' // spending limit hit (result.subtype === 'error_max_budget_usd')
  | 'execution_error' // unrecoverable execution error (result.subtype === 'error_during_execution')
  | 'structured_output_error' // structured output validation failed (result.subtype === 'error_max_structured_output_retries')

/** Conversation engine kind for managed sessions. */
export type AIEngineKind = 'claude' | 'codex'

// ─── Session Origin (discriminated union) ─────────────────────────────────
//
// Tracks where a session was created from and carries the source-specific
// context ID needed for filtering, routing and idempotency checks.
//
//   agent          — created from the top Agent panel (no extra context)
//   issue          — linked to a specific Issue (carries issueId)
//   telegram       — created by a Telegram Bot (carries botId + chatId for reply routing)
//                    chatId is the Telegram chat that initiated the session and is the
//                    routing target for all Claude responses; one session per (botId, chatId) pair.
//   schedule       — created by a Schedule runner (carries scheduleId)
//   hook           — created by a Webhook trigger (carries webhookId)
//   browser-agent  — created from the floating Browser workspace Agent panel
//   skill-creator  — created from the AI Skill Creator conversational flow
//   issue-creator  — created from the AI Issue Creator conversational flow (Drawer)
//   schedule-creator — created from the AI Schedule Creator conversational flow (Modal)
//   review         — created from DiffChangesDialog for code review chat.
//                    Carries the original issueId + sessionId for AI context.
//                    turnAnchorMessageId distinguishes turn-level vs session-level:
//                      undefined  → session-level review (all session changes)
//                      string     → turn-level review (anchored by the turn's first message ID)
//                    Intentionally NOT recognized by getOriginIssueId() so it
//                    won't trigger issue status side-effects.

export type SessionOrigin =
  | { source: 'agent' }
  | { source: 'issue'; issueId: string }
  | { source: 'telegram'; botId: string; chatId: string }
  | { source: 'feishu'; appId: string; chatId: string }
  | { source: 'discord'; botId: string; channelId: string; guildId?: string }
  | { source: 'weixin'; connectionId: string; userId: string }
  | { source: 'schedule'; scheduleId: string }
  | { source: 'hook'; webhookId: string }
  | { source: 'browser-agent' }
  | { source: 'review'; issueId: string; sessionId: string; turnAnchorMessageId?: string }
  | { source: 'skill-creator' }
  | { source: 'agent-creator' }
  | { source: 'command-creator' }
  | { source: 'rule-creator' }
  | { source: 'issue-creator' }
  | { source: 'schedule-creator' }
  | { source: 'bot-creator' }
  | { source: 'market-analyzer'; slug: string; marketplaceId: string }

export type SessionSource = SessionOrigin['source']

/** Categories that support AI-assisted creation via a conversational Creator modal. */
export type AICreatableCategory = 'skill' | 'command' | 'agent' | 'rule'

/** Set of AI-creatable category IDs for runtime membership checks. */
const AI_CREATABLE_SET: ReadonlySet<string> = new Set<AICreatableCategory>([
  'skill',
  'command',
  'agent',
  'rule'
])

/** Type guard: returns true if `id` is an AI-creatable category. */
export function isAICreatableCategory(id: string): id is AICreatableCategory {
  return AI_CREATABLE_SET.has(id)
}

/**
 * Build a properly-typed SessionOrigin for an AI Creator category.
 * Eliminates the need for `as any` casts when constructing creator origins.
 */
export function buildCreatorOrigin(category: AICreatableCategory): SessionOrigin {
  switch (category) {
    case 'skill':
      return { source: 'skill-creator' }
    case 'agent':
      return { source: 'agent-creator' }
    case 'command':
      return { source: 'command-creator' }
    case 'rule':
      return { source: 'rule-creator' }
  }
}

/**
 * Extract the issueId from any SessionOrigin.
 * Returns null for non-issue origins — replaces direct `info.issueId` access.
 */
export function getOriginIssueId(origin: SessionOrigin): string | null {
  return origin.source === 'issue' ? origin.issueId : null
}

export interface StartSessionNativeToolAllowItem {
  /** Native capability category key (e.g. "browser", "evose"). */
  capability: string
  /**
   * Optional fine-grained tool name.
   * - omitted: allow all tools from the capability.
   * - set: allow only this specific tool.
   */
  tool?: string
}

export interface StartSessionPolicyInput {
  tools?: {
    builtin?: {
      enabled?: boolean
    }
    native?: {
      mode?: 'none' | 'allowlist'
      allow?: StartSessionNativeToolAllowItem[]
    }
  }
  capabilities?: {
    skill?: {
      maxChars?: number
      explicit?: string[]
      implicitQuery?: string
    }
  }
}

export interface StartSessionPolicy {
  tools: {
    builtin: {
      enabled: boolean
    }
    native: {
      mode: 'none' | 'allowlist'
      allow: StartSessionNativeToolAllowItem[]
    }
  }
  capabilities: {
    skill: {
      maxChars: number
      explicit: string[]
      implicitQuery?: string
    }
  }
}

export interface ManagedSessionConfig {
  prompt: UserMessageContent
  origin: SessionOrigin
  /** Conversation engine kind. Defaults to 'claude'. */
  engineKind?: AIEngineKind
  /** Engine-specific checkpoint/thread state. */
  engineState?: Record<string, unknown> | null
  projectPath?: string
  /** Resolved Project ID — set at session creation time, persisted for resume. */
  projectId?: string
  model?: string
  maxTurns?: number
  permissionMode?: string
  // ── Browser Agent extensions ──
  /** Custom system prompt (replaces Claude Code default) */
  systemPrompt?: string
  /** Structured per-session policy (tools, native allowlist, skill activation budget). */
  policy?: StartSessionPolicyInput
  // ── Capability Center injection ──
  /** Agent name to activate for this session (boosts agent-linked skills) */
  agentName?: string
  // ── Context injection ──
  /**
   * Resolved context from Issue.contextRefs, auto-populated by ContextRefResolver
   * for issue-originated sessions. Prepended to systemPrompt before SDK call.
   * Can also be set explicitly to inject custom context for any session origin.
   */
  contextSystemPrompt?: string
}

export type ManagedSessionMessage =
  | {
      id: string
      role: 'user'
      content: ContentBlock[]
      timestamp: number
    }
  | {
      id: string
      role: 'assistant'
      content: ContentBlock[]
      timestamp: number
      isStreaming?: boolean
      activeToolUseId?: string | null
    }
  | {
      id: string
      role: 'system'
      event: SystemEvent
      timestamp: number
    }

// ─── Session Execution Context ──────────────────────────────────────────

/**
 * Session runtime execution context.
 * Describes the session's actual working environment, NOT the startup config.
 * Updated when the agent switches worktrees or branches.
 */
export interface SessionExecutionContext {
  /** Current working directory (may differ from projectPath after EnterWorktree) */
  cwd: string
  /** Current Git branch name; null for non-git projects or detached HEAD */
  gitBranch: string | null
  /** Whether the session is in a detached HEAD state */
  isDetached: boolean
  /** Whether the session is running inside a worktree (cwd !== projectPath and not a subdirectory) */
  isWorktree: boolean
  /** Last update timestamp (epoch ms) */
  updatedAt: number
}

/**
 * Runtime-only context telemetry snapshot from engine-native token counters.
 * Not persisted in DB; produced and consumed only within active process memory.
 */
export interface SessionContextTelemetry {
  usedTokens: number
  limitTokens: number
  remainingTokens: number
  remainingPct: number
  source: string
  confidence: 'authoritative' | 'estimated'
  updatedAtMs: number
}

/**
 * Canonical runtime context state used inside session domain.
 * `limitTokens` can be null before an authoritative/provider limit is known.
 */
export interface SessionContextState {
  usedTokens: number
  limitTokens: number | null
  source: string
  confidence: 'authoritative' | 'estimated'
  updatedAtMs: number
}

/**
 * Lightweight session metadata snapshot — all scalar fields, **no messages**.
 *
 * O(1) to produce from `ManagedSession.snapshot()`. Used by:
 *   - DataBus events (`command:session:created`, `command:session:updated`)
 *   - IPC queries (`command:list-managed-sessions`, `command:get-managed-session`)
 *   - Renderer stores (session metadata display)
 *   - Transition projectors and engine-event projectors
 *
 * For full persistence (including messages), use `ManagedSessionInfo`.
 */
export interface SessionSnapshot {
  id: string
  engineKind: AIEngineKind
  /** Engine-specific session/thread reference (canonical). */
  engineSessionRef: string | null
  /** Engine-specific checkpoint/thread state payload. */
  engineState: Record<string, unknown> | null
  state: ManagedSessionState
  stopReason: SessionStopReason | null
  /** Session origin — replaces the old flat `issueId` field. Use getOriginIssueId(info.origin) to get the issue ID. */
  origin: SessionOrigin
  projectPath: string | null
  /** Resolved Project ID — null when session is not scoped to a project. */
  projectId: string | null
  model: string | null
  createdAt: number
  lastActivity: number
  /**
   * Cumulative duration (ms) the session has spent in "active" states
   * (`creating`, `streaming`, `stopping`).
   * Idle / waiting periods are **excluded**.
   */
  activeDurationMs: number
  /**
   * Epoch ms when the session last entered an active state.
   * `null` when the session is NOT currently active — in that case
   * `activeDurationMs` already represents the full active time.
   *
   * For real-time display: `activeDurationMs + (Date.now() - activeStartedAt)`
   */
  activeStartedAt: number | null
  totalCostUsd: number
  inputTokens: number
  outputTokens: number
  /** Last turn's normalized context usage token count. */
  lastInputTokens: number
  /**
   * Runtime-only context window override from provider metadata (e.g. Claude modelUsage.contextWindow).
   * Not persisted; when absent, UI falls back to static engine/model limits.
   */
  contextLimitOverride?: number | null
  /** Canonical runtime context state (single source of truth). */
  contextState?: SessionContextState | null
  /** Runtime-only context telemetry from same-source token counters (e.g. codex token_count). */
  contextTelemetry?: SessionContextTelemetry | null
  activity: string | null
  error: string | null
  /** Session runtime execution context; null when not yet initialized (creating phase) */
  executionContext: SessionExecutionContext | null
}

/**
 * Full session record including messages — used **only** for persistence and
 * scenarios that genuinely need the message array (artifact extraction, transcript building).
 *
 * O(n) to produce from `ManagedSession.toPersistenceRecord()`.
 */
export interface ManagedSessionInfo extends SessionSnapshot {
  messages: ManagedSessionMessage[]
}

export interface StartSessionInput {
  prompt: UserMessageContent
  /** Session origin — determines routing and idempotency behavior. Defaults to {source:'agent'} if omitted. */
  origin?: SessionOrigin
  /** Conversation engine kind. Defaults to 'claude'. */
  engineKind?: AIEngineKind
  projectPath?: string
  /** Pre-resolved Project ID. Frontend passes this directly; IPC handler resolves as fallback for non-frontend callers. */
  projectId?: string
  model?: string
  maxTurns?: number
  // ── Tool & capability control ──
  systemPrompt?: string
  /** Structured session policy (native tool allowlist + capability injection policy). */
  policy?: StartSessionPolicyInput
  // ── Context injection ──
  /**
   * Resolved context from Issue.contextRefs, auto-populated by ContextRefResolver
   * for issue-originated sessions. Prepended to systemPrompt before SDK call.
   * Can also be set explicitly to inject custom context for any session origin.
   */
  contextSystemPrompt?: string
}

// === Settings ===

export type ThemeMode = 'light' | 'dark' | 'system'

/** Available color schemes — maps 1:1 to `.theme-{scheme}` CSS class.
 *  Neutral group: gray-scale palettes with different hue tints.
 *  Accent group: vibrant primary color palettes. */
export type ThemeScheme =
  | 'zinc'
  | 'slate'
  | 'stone'
  | 'gray'
  | 'neutral'
  | 'blue'
  | 'green'
  | 'violet'
  | 'rose'
  | 'orange'

/** Surface texture style — maps 1:1 to `.texture-{id}` CSS class on `<html>`. */
export type ThemeTexture = 'plain' | 'glass'

/** Surface elevation level for the texture system.
 *  Higher elevation = stronger glass effect in glass mode. */
export type SurfaceElevation = 'ground' | 'raised' | 'floating' | 'modal' | 'overlay'

/** Semantic color variable name (without `--` prefix) used by a surface element.
 *  Maps to the CSS custom property that defines the surface's base color. */
export type SurfaceSemanticColor = 'card' | 'popover' | 'background' | 'sidebar-background'

/** Structured theme configuration — mode × scheme × texture (three-axis). */
export interface ThemeConfig {
  mode: ThemeMode
  scheme: ThemeScheme
  texture: ThemeTexture
}

export type PermissionMode = 'bypassPermissions' | 'default'

export interface ProxySettings {
  httpsProxy: string
  httpProxy: string
  noProxy: string
}

export interface CommandDefaults {
  maxTurns: number
  permissionMode: PermissionMode
  /** Default engine used when startSession input does not specify engineKind. */
  defaultEngine: AIEngineKind
}

export interface EventSubscriptionSettings {
  enabled: boolean
  onError: boolean
  onComplete: boolean
  onStatusChange: boolean
}

// === Webhook Types ===

export type WebhookProviderType = 'lark' | 'telegram' | 'custom'

export type WebhookEventKind =
  | 'session_complete'
  | 'session_error'
  | 'session_waiting'
  | 'session_start'
  | 'task_completed'
  | 'notification'

export interface WebhookEndpoint {
  id: string
  name: string
  provider: WebhookProviderType
  url: string
  secret: string
  enabled: boolean
  /** Whether to route HTTP requests through the global proxy (Settings → Network). */
  useProxy: boolean
  subscribedEvents: WebhookEventKind[]
  createdAt: number
  lastTriggeredAt: number | null
  lastError: string | null
}

export interface WebhookSettings {
  endpoints: WebhookEndpoint[]
}

export interface WebhookTestResult {
  success: boolean
  statusCode?: number
  error?: string
  durationMs: number
}

// === Messaging — Unified IM Types ===

/** IM platform identifier. */
export type IMPlatformType = 'telegram' | 'feishu' | 'discord' | 'weixin'

/**
 * Runtime set of all IM platform source strings.
 *
 * This is the **single source of truth** — all "is this an IM platform?"
 * checks across the codebase MUST use this set (or the helper below) rather
 * than maintaining their own copies. When a new IM platform is added, update
 * `IMPlatformType` above and this set — nothing else.
 */
export const IM_PLATFORM_SOURCES: ReadonlySet<string> = new Set<IMPlatformType>([
  'telegram',
  'feishu',
  'discord',
  'weixin',
])

/** Check whether a session-origin source string represents an IM platform. */
export function isIMPlatformSource(source: string): boolean {
  return IM_PLATFORM_SOURCES.has(source)
}

/** Connection status values shared by all IM platforms. */
export type IMConnectionStatusType = 'disconnected' | 'connecting' | 'connected' | 'error'

// ── Unified IM Connection (Discriminated Union by `platform`) ──

/** Fields shared by every IM connection, regardless of platform. */
interface IMConnectionBase {
  id: string
  name: string
  platform: IMPlatformType
  enabled: boolean
  /** User IDs allowed to interact (string[] for all platforms; empty = allow everyone). */
  allowedUserIds: string[]
  /** Default working directory for sessions started from this connection. */
  defaultWorkspacePath: string
  defaultProjectId?: string
}

/** Telegram connection configuration. */
export interface TelegramConnection extends IMConnectionBase {
  platform: 'telegram'
  /** Bot Token obtained from @BotFather. */
  botToken: string
}

/** Feishu (Lark) connection configuration. */
export interface FeishuConnection extends IMConnectionBase {
  platform: 'feishu'
  /** API domain — 'feishu' for China (open.feishu.cn), 'lark' for International (open.larksuite.com). */
  domain?: 'feishu' | 'lark'
  appId: string
  appSecret: string
}

/** Discord connection configuration. */
export interface DiscordConnection extends IMConnectionBase {
  platform: 'discord'
  botToken: string
  guildId?: string
}

/**
 * WeChat (Weixin) connection configuration.
 * Uses the iLink protocol via `ilinkai.weixin.qq.com`.
 * Token is obtained through QR code scanning — not manually entered.
 */
export interface WeixinConnection extends IMConnectionBase {
  platform: 'weixin'
  /**
   * Bot token obtained via QR code scan.
   * Empty string on first configuration — auto-filled after successful scan.
   */
  botToken: string
  /**
   * iLink server base URL.
   * Defaults to `https://ilinkai.weixin.qq.com` but the protocol allows dynamic assignment.
   */
  baseUrl?: string
}

/** All IM connections — discriminated union keyed by `platform`. */
export type IMConnection = TelegramConnection | FeishuConnection | DiscordConnection | WeixinConnection

/** Settings container stored under `AppSettings.messaging`. */
export interface MessagingSettings {
  connections: IMConnection[]
}

/** Unified runtime status for any IM connection. */
export interface IMConnectionStatus {
  connectionId: string
  platform: IMPlatformType
  connectionStatus: IMConnectionStatusType
  connectedAt: number | null
  lastError: string | null
  /** Platform-specific runtime metadata (read-only, not persisted). */
  metadata?: {
    botUsername?: string       // Telegram: @username
    messagesReceived?: number  // message counters
    messagesSent?: number
  }
}

// ── Legacy: TelegramBotEntry (internal to TelegramBotManager) ──

/**
 * Internal configuration for a single Telegram Bot instance.
 * Used only inside `TelegramBotManager` / `TelegramBotService`.
 * The public Settings model uses `TelegramConnection` instead.
 */
export interface TelegramBotEntry {
  id: string
  name: string
  enabled: boolean
  botToken: string
  /** Telegram user IDs (number[]) — grammy requires numeric IDs. */
  allowedUserIds: number[]
  defaultWorkspacePath: string
  defaultProjectId?: string
}

/** Internal multi-bot settings container for TelegramBotManager. */
export interface TelegramBotSettings {
  bots: TelegramBotEntry[]
}

/** Internal runtime status from TelegramBotService. */
export interface TelegramBotStatus {
  botId: string
  connectionStatus: IMConnectionStatusType
  connectedAt: number | null
  lastError: string | null
  botUsername: string | null
  messagesReceived: number
  messagesSent: number
}

// === Evose Integration Types ===

/** App metadata fetched from the Evose API (runtime only, not persisted) */
export interface EvoseApp {
  id: string
  name: string
  type: 'agent' | 'workflow'
  description: string
  avatar?: string // App avatar URL (from /v1/apps response)
}

/** User-configured single App (persisted) */
export interface EvoseAppConfig {
  appId: string
  name: string // Redundantly stored so tools can still be registered when offline
  type: 'agent' | 'workflow'
  enabled: boolean
  description?: string // App description, used as MCP tool description (improves Claude's understanding)
  avatar?: string // App avatar URL, redundantly stored
}

/** Evose integration settings */
export interface EvoseSettings {
  apiKey: string
  baseUrl: string // Defaults to 'https://api-app.evose.ai'
  workspaceIds: string[] // List of workspace IDs; entered as comma-separated values in the UI
  apps: EvoseAppConfig[]
}

/**
 * Default values are defined adjacent to the interface to eliminate cross-file circular dependency risks.
 * Both settingsService.ts and evoseService.ts import from here.
 */
export const DEFAULT_EVOSE_SETTINGS: EvoseSettings = {
  apiKey: '',
  baseUrl: 'https://api-app.evose.ai',
  workspaceIds: [],
  apps: []
}

/**
 * Orchestrator methods required by all IM platform adapters.
 * Platform-agnostic — session management is the same regardless of
 * whether the message came from Telegram, Feishu, or Discord.
 */
export interface IMOrchestratorDeps {
  startSession: (input: StartSessionInput) => Promise<string>
  sendMessage: (sessionId: string, content: UserMessageContent) => Promise<boolean>
  resumeSession: (sessionId: string, content: UserMessageContent) => Promise<boolean>
  stopSession: (sessionId: string) => Promise<boolean>
  listSessions: () => Promise<SessionSnapshot[]>
  getSession: (sessionId: string) => Promise<SessionSnapshot | null>
}

// === Provider ===

export type ApiProvider = 'subscription' | 'api_key' | 'openrouter' | 'custom'
export type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** Non-sensitive credential fields returned for pre-filling the edit form. API key is included (masked in UI). */
export interface ProviderCredentialInfo {
  apiKey?: string
  baseUrl?: string
  authStyle?: 'api_key' | 'bearer'
}

export type ProviderStatusState = 'authenticated' | 'unauthenticated' | 'authenticating' | 'error'

export interface ProviderStatus {
  state: ProviderStatusState
  mode: ApiProvider | null
  detail?: {
    email?: string
    organization?: string
    subscriptionType?: string
  }
  error?: string
}

/** Non-sensitive provider config (persisted in settings.json). Secrets live in CredentialStore. */
export interface ProviderEngineSettings {
  activeMode: ApiProvider | null
  /** Optional per-engine default model hint. */
  defaultModel?: string
  /** Optional default reasoning effort for Codex model calls. */
  defaultReasoningEffort?: CodexReasoningEffort
}

/** Engine-scoped provider configuration. */
export interface ProviderSettings {
  byEngine: Record<AIEngineKind, ProviderEngineSettings>
}

// === Update Settings ===

/** How often to check for updates via GitHub Releases. */
export type UpdateCheckInterval = '1h' | '4h' | '12h' | '24h'

export interface UpdateSettings {
  /** Whether to automatically check for updates on startup and periodically. */
  autoCheckUpdates: boolean
  /** Interval between automatic update checks. */
  updateCheckInterval: UpdateCheckInterval
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
  autoCheckUpdates: true,
  updateCheckInterval: '4h',
}

/** Result of a GitHub Releases update check, dispatched via DataBus. */
export type UpdateCheckResult =
  | {
      status: 'available'
      currentVersion: string
      latestVersion: string
      releaseUrl: string
      releaseNotes: string
      publishedAt: string
      downloadUrl: string | null
      checkedAt: string
    }
  | {
      status: 'up-to-date'
      currentVersion: string
      checkedAt: string
    }

// === Settings ===

export interface AppSettings {
  theme: ThemeConfig
  proxy: ProxySettings
  command: CommandDefaults
  eventSubscriptions: EventSubscriptionSettings
  webhooks: WebhookSettings
  provider: ProviderSettings
  messaging: MessagingSettings
  schedule: ScheduleSettings
  evose: EvoseSettings
  language: LanguagePref
  updates: UpdateSettings
}

// === Session Notes ===

/**
 * The content payload of a note — text, rich editor state, and images.
 *
 * These three fields always travel together and represent a single cohesive
 * unit. Using a dedicated type eliminates positional-argument ordering bugs
 * and makes every layer's signature self-documenting.
 */
export interface NoteContent {
  /** Plain-text representation (for display, search, backward compat) */
  text: string
  /**
   * TipTap document JSON — preserves slash mention nodes for lossless
   * editor round-trip and structured send-to-chat resolution.
   * Omitted (or undefined) for plain-text notes.
   */
  richContent?: string
  /** Inline image attachments (same format as Issue images). */
  images?: IssueImage[]
}

/** A note attached to an Issue — persists across session restarts. */
export interface SessionNote {
  id: string
  issueId: string
  content: NoteContent
  /** File path from which the note was created (via file preview popover) */
  sourceFilePath: string | null
  createdAt: number
  updatedAt: number
}

export interface CreateNoteInput {
  issueId: string
  content: NoteContent
  sourceFilePath?: string
}

// === Artifacts ===

/** Artifact kind — determines extraction strategy and rendering strategy. */
export type ArtifactKind = 'file' | 'diagram'
// Future: | 'image' | 'snippet' | 'card'

/** How the artifact was captured */
export type ArtifactSource = 'managed' | 'monitor' | 'project_file'

/** Renderer type — resolved at read time via resolveRenderer(), not stored in DB */
export type ArtifactRenderer = 'markdown' | 'html' | 'code' | 'mermaid' | 'image' | 'raw'

/** Artifact domain model (IPC transfer — excludes content to keep payloads lightweight) */
export interface Artifact {
  id: string
  kind: ArtifactKind
  title: string // Human-readable title (fileName for files)
  mimeType: string // Content MIME type
  filePath: string | null // Only for 'file' kind
  fileExtension: string | null // Only for 'file' kind (with leading dot)
  /** null for project_file source (no session context) */
  sessionId: string | null
  issueId: string | null
  projectId: string | null
  source: ArtifactSource
  contentHash: string
  contentLength: number
  /** First ≤2 000 chars of content, returned by list queries for card previews.
   *  Full content is fetched on demand via `get-artifact-content`. */
  contentPreview: string | null
  starred: boolean
  starredAt: number | null
  stats: { writes: number; edits: number }
  createdAt: number
  updatedAt: number
}

export interface ArtifactFilter {
  starred?: boolean
  issueId?: string
  projectId?: string
  sessionId?: string
  kind?: ArtifactKind
  fileExtension?: string
}

export interface ArtifactMetaPatch {
  starred?: boolean
  issueId?: string | null
}

/**
 * Input for the Eager Persist + Star IPC channel.
 *
 * Self-contained (no circular import from artifactExtraction.ts).
 * The renderer constructs this from ExtractedArtifact + session context.
 */
export interface StarArtifactInput {
  // Artifact data (mirrors ExtractedArtifact shape)
  kind: ArtifactKind
  title: string
  mimeType: string
  filePath: string | null
  fileExtension: string | null
  content: string | null
  contentHash: string
  stats: { writes: number; edits: number }
  // Session context
  sessionId: string
  issueId: string | null
  projectId: string | null
  // Star intent
  starred: boolean
}

/**
 * Explicit star context passed to file viewer components.
 *
 * Discriminated union so callers declare WHICH context they operate in,
 * rather than letting the viewer silently probe ambient React context.
 *
 *   session → artifact linked to session (uses star-session-artifact IPC)
 *   project → artifact linked to project only (uses star-project-file IPC)
 */
export type FileViewerStarContext =
  | { type: 'session'; sessionId: string; issueId: string | null; projectId: string | null }
  | { type: 'project'; projectId: string }

/**
 * Input for starring a project file (no session context).
 * Used by FileBrowser when the user stars a file outside any session.
 */
export interface StarProjectFileInput {
  // File data
  filePath: string // Absolute filesystem path
  fileExtension: string | null
  content: string
  contentHash: string
  // Project context
  projectId: string
  // Star intent
  starred: boolean
}

// === Browser Types (IPC payloads — self-contained, no electron imports) ===

export type BrowserExecutorState = 'idle' | 'attaching' | 'ready' | 'detached' | 'error'

export interface BrowserProfileInfo {
  id: string
  name: string
  partition: string
  allowedDomains: string[]
  cookiePersistence: boolean
  createdAt: number
  lastUsedAt: number
}

export interface BrowserCreateProfileInput {
  name: string
  allowedDomains?: string[]
  cookiePersistence?: boolean
}

export interface BrowserShowContext {
  /**
   * The session that opened the browser.
   *
   * When set (Path A — session-linked mode), the browser window displays this
   * session's view. The window's chat panel routes user messages directly to
   * this session rather than creating a new browser-agent session.
   *
   * Set by `IssueDetailView` when the Issue has an active session:
   *   `linkedSessionId: session?.id`
   */
  linkedSessionId?: string

  /**
   * The Issue that triggered the browser window open.
   *
   * Always set by `IssueDetailView`. Determines view isolation strategy:
   * - With `linkedSessionId` (Path A): used only for context, view is managed
   *   by the session-view mechanism.
   * - Without `linkedSessionId` (Path B — issue-standalone mode): the main
   *   process creates / reuses a per-issue `WebContentsView` so each Issue
   *   has its own persistent browser state independent of any session.
   */
  sourceIssueId?: string

  initialUrl?: string
  profileId?: string
}

// ─── Browser Source (Discriminated Union) ────────────────────────────────

/**
 * The origin of a browser context.
 *
 * Explicitly answers "who does this browser belong to?" using a discriminated union
 * instead of optional field combinations, eliminating illegal state space.
 *
 * Each variant carries the minimum identifying information needed for its scenario;
 * switch + exhaustiveness checking ensures the compiler flags any new variant.
 */
export type BrowserSource =
  | { type: 'issue-session'; issueId: string; sessionId: string }
  | { type: 'issue-standalone'; issueId: string }
  | { type: 'chat-session'; sessionId: string }
  | { type: 'standalone' }

/** Optional parameters for openBrowserOverlay (separated from source to avoid mixing domain identity with UI options) */
export interface BrowserOpenOptions {
  initialUrl?: string
  profileId?: string
}

// ─── Browser Overlay State ───────────────────────────────────────────────

/**
 * Complete state while the overlay is open.
 *
 * Aggregates all information needed by the browser at runtime,
 * serving as the single data source for the BrowserSheet component tree.
 */
export interface BrowserOverlayState {
  // ── Source ──
  source: BrowserSource

  // ── View ──
  viewId: string | null
  executorState: BrowserExecutorState
  pageInfo: BrowserPageInfoPayload | null
  isLoading: boolean

  // ── Profile ──
  profiles: BrowserProfileInfo[]
  activeProfileId: string | null

  // ── URL Bar ──
  urlBarValue: string
  urlBarFocused: boolean

  // ── Agent Session ──
  agentSessionId: string | null
  /**
   * Optimistic agent state hint.
   *
   * Only meaningful during the brief window between `command:start-session`
   * IPC call and the corresponding `command:session:created` DataBus event.
   * During that gap, `commandStore.sessionById` doesn't have the session yet,
   * so this field provides the `'creating'` hint to prevent a UI flash.
   *
   * Once the session exists in `commandStore`, consumers should prefer
   * `commandStore.sessionById[agentSessionId].state` over this field.
   */
  agentState: ManagedSessionState | null

  // ── Chat Input ──
  chatInput: string
  isChatSending: boolean

  // ── Action Feedback ──
  currentAction: string | null

  // ── UI ──
  chatPanelWidth: number
  chatPanelCollapsed: boolean
}

/**
 * A single item in the Source Switcher dropdown.
 *
 * Carries all information needed for rendering, avoiding additional queries when the dropdown opens.
 */
export interface ActiveBrowserSource {
  source: BrowserSource
  viewId: string
  /** Display name (Issue title / Chat name / "Browser") */
  displayName: string
}

export interface BrowserSyncBoundsParams {
  viewId: string
  bounds: { x: number; y: number; width: number; height: number }
}

/** Discriminated union of all browser actions (IPC-safe, no electron types). */
export type BrowserCommandPayload =
  | { viewId: string; action: 'navigate'; url: string }
  | { viewId: string; action: 'go-back' }
  | { viewId: string; action: 'go-forward' }
  | { viewId: string; action: 'reload' }
  | { viewId: string; action: 'click'; selector: string }
  | { viewId: string; action: 'type'; selector: string; text: string }
  | { viewId: string; action: 'select'; selector: string; value: string }
  | { viewId: string; action: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { viewId: string; action: 'wait-for-selector'; selector: string; timeout?: number }
  | { viewId: string; action: 'extract-text'; selector?: string }
  | { viewId: string; action: 'extract-page' }
  | { viewId: string; action: 'screenshot' }
  | { viewId: string; action: 'evaluate'; expression: string }
  | { viewId: string; action: 'download'; url: string; filename?: string }

export type BrowserCommandResultPayload =
  | { status: 'success'; data?: unknown }
  | { status: 'error'; error: BrowserErrorPayload }

export interface BrowserErrorPayload {
  code: string
  message: string
  [key: string]: unknown
}

export interface BrowserPageInfoPayload {
  url: string
  title: string
  isLoading: boolean
}

/**
 * Snapshot of the currently active browser view.
 * Returned by `browser:get-active-view` IPC for renderer catch-up on mount.
 */
export interface BrowserActiveViewPayload {
  viewId: string
  profileId: string
}

// === Schedule Module Types ===

export type ScheduleStatus = 'active' | 'paused' | 'completed' | 'error'
export type SchedulePriority = 'critical' | 'high' | 'normal' | 'low'

// === Frequency Configuration ===

export type FrequencyType =
  | 'once'
  | 'interval'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'cron'

export type WorkMode = 'all_days' | 'weekdays' | 'big_small_week'

export interface BiweeklyConfig {
  bigWeekDays: number[]
  smallWeekDays: number[]
  referenceDate: string
  referenceIsBig: boolean
}

export interface ScheduleFrequency {
  type: FrequencyType
  workMode: WorkMode
  timezone: string

  // interval mode
  intervalMinutes?: number

  // daily / weekly / biweekly / monthly shared
  timeOfDay?: string

  // weekly mode
  daysOfWeek?: number[]

  // biweekly mode
  biweeklyConfig?: BiweeklyConfig

  // monthly mode
  dayOfMonth?: number

  // cron mode
  cronExpression?: string

  // once mode — Unix timestamp (ms) of the single execution
  executeAt?: number
}

// === Trigger Configuration ===

export interface ScheduleTrigger {
  time?: ScheduleFrequency
  event?: EventTriggerConfig
  throttleMs?: number
}

export interface EventTriggerConfig {
  matcherType: string
  filter: Record<string, unknown>
}

// === Action Configuration ===

export type ActionType =
  | 'start_session'
  | 'resume_session'
  | 'create_issue'
  | 'webhook'
  | 'notification'

export type ContextInjectionType =
  | 'git_diff_24h'
  | 'git_log_week'
  | 'last_execution_result'
  | 'open_issues'
  | 'today_stats'
  | 'recent_errors'
  | 'changed_files'

export interface ScheduleAction {
  type: ActionType

  // start_session / resume_session
  session?: {
    promptTemplate: string
    model?: string
    maxTurns?: number
    permissionMode?: 'bypassPermissions' | 'default'
    timeoutMs?: number
  }

  // resume_session
  resumeMode?: 'resume_last' | 'resume_specific'
  resumeSessionId?: string

  // related entities
  /**
   * Canonical project binding — the project this action targets at runtime.
   * Schedule.projectId is a denormalized copy kept in sync by the service
   * layer for efficient DB-level queries.
   */
  projectId?: string
  issueId?: string

  // dynamic context injection
  contextInjections?: ContextInjectionType[]
}

// === Failure Policy ===

export interface FailurePolicy {
  maxRetries: number
  retryBackoff: 'fixed' | 'exponential'
  retryDelayMs: number
  pauseAfterConsecutiveFailures: number
  notifyOnFailure: boolean
  webhookOnFailure: boolean
}

export type MissedExecutionPolicy = 'skip' | 'run_once' | 'run_if_within'

export type ConcurrencyPolicy = 'skip' | 'queue' | 'replace'

// === Schedule Entity ===

export interface Schedule {
  id: string
  name: string
  description: string

  trigger: ScheduleTrigger
  action: ScheduleAction
  priority: SchedulePriority

  failurePolicy: FailurePolicy
  missedPolicy: MissedExecutionPolicy
  concurrencyPolicy: ConcurrencyPolicy

  status: ScheduleStatus
  nextRunAt: number | null
  lastRunAt: number | null
  lastRunStatus: 'success' | 'failed' | 'skipped' | null
  lastRunError: string | null

  startDate?: number
  endDate?: number
  maxExecutions?: number
  executionCount: number
  consecutiveFailures: number

  /**
   * Denormalized copy of action.projectId — kept in sync by the service
   * layer. Exists solely for efficient DB-level queries (filter, cascade
   * delete). The canonical source is always {@link ScheduleAction.projectId}.
   */
  projectId: string | null
  createdAt: number
  updatedAt: number
}

// === Pipeline Entity (Chain Execution) ===

export interface SchedulePipeline {
  id: string
  name: string
  description: string
  steps: PipelineStep[]
  failurePolicy: 'stop_chain' | 'skip_step' | 'retry_step'
  status: 'active' | 'paused'
  projectId: string | null
  createdAt: number
  updatedAt: number
}

export interface PipelineStep {
  order: number
  scheduleId: string
  condition: StepCondition
}

export type StepCondition =
  | { type: 'always' }
  | { type: 'previous_success' }
  | { type: 'previous_failure' }
  | { type: 'previous_status'; status: 'success' | 'failed' | 'skipped' }

// === Execution Record ===

export type ExecutionStatus = 'running' | 'success' | 'failed' | 'skipped' | 'timeout' | 'cancelled'

export type ExecutionTriggerType = 'scheduled' | 'event' | 'manual' | 'retry' | 'chain' | 'catchup'

export interface ScheduleExecution {
  id: string
  scheduleId: string
  pipelineId: string | null
  pipelineStepOrder: number | null

  triggerType: ExecutionTriggerType
  triggerDetail: string | null

  status: ExecutionStatus
  resolvedPrompt: string | null
  sessionId: string | null
  issueId: string | null
  error: string | null

  scheduledAt: number
  startedAt: number
  completedAt: number | null
  durationMs: number | null

  costUsd: number
  inputTokens: number
  outputTokens: number
}

// === Trigger Event (internal) ===

export interface TriggerEvent {
  scheduleId: string
  reason: ExecutionTriggerType
  timestamp: number
  scheduledAt?: number
  eventType?: string
  pipelineId?: string
  pipelineStepOrder?: number
}

// === Execution Context (pipeline internal) ===

export interface ExecutionContext {
  schedule: Schedule
  trigger: TriggerEvent
  execution: ScheduleExecution

  resolvedPrompt?: string
  injectedContext?: Record<string, string>

  aborted: boolean
  abortReason?: string
  skipped: boolean
  skipReason?: string
}

// === Pipeline Middleware Interface ===

export interface PipelineMiddleware {
  readonly name: string
  execute(ctx: ExecutionContext, next: () => Promise<void>): Promise<void>
}

// === Context Injector Interface ===

export interface ContextInjector {
  readonly type: ContextInjectionType
  inject(schedule: Schedule): Promise<string>
}

// === Trigger Matcher Interface ===

export interface TriggerMatcher {
  readonly type: string
  matches(event: DataBusEvent, filter: Record<string, unknown>): boolean
}

// === Schedule CRUD Input Types ===

export interface ScheduleFilter {
  statuses?: ScheduleStatus[]
  projectId?: string
  search?: string
}

export interface CreateScheduleInput {
  name: string
  description?: string
  trigger: ScheduleTrigger
  action: ScheduleAction
  priority?: SchedulePriority
  failurePolicy?: Partial<FailurePolicy>
  missedPolicy?: MissedExecutionPolicy
  concurrencyPolicy?: ConcurrencyPolicy
  startDate?: number
  endDate?: number
  maxExecutions?: number
  projectId?: string | null
}

export interface UpdateScheduleInput {
  name?: string
  description?: string
  trigger?: ScheduleTrigger
  action?: ScheduleAction
  priority?: SchedulePriority
  failurePolicy?: Partial<FailurePolicy>
  missedPolicy?: MissedExecutionPolicy
  concurrencyPolicy?: ConcurrencyPolicy
  startDate?: number
  endDate?: number
  maxExecutions?: number
  projectId?: string | null
}

// === Pipeline CRUD Input Types ===

export interface CreatePipelineInput {
  name: string
  description?: string
  steps: PipelineStep[]
  failurePolicy?: SchedulePipeline['failurePolicy']
  projectId?: string | null
}

export interface UpdatePipelineInput {
  name?: string
  description?: string
  steps?: PipelineStep[]
  failurePolicy?: SchedulePipeline['failurePolicy']
  projectId?: string | null
}

// === Schedule Settings ===

export interface ScheduleSettings {
  enabled: boolean
  maxConcurrentExecutions: number
  quietHours: {
    enabled: boolean
    start: string
    end: string
  }
}

// === Schedule Limits ===

export const SCHEDULE_LIMITS = {
  maxSchedulesPerProject: 20,
  maxSchedulesTotal: 100,
  maxPipelines: 30,
  maxPipelineSteps: 10,
  minIntervalMs: 60_000,
  maxConcurrentExecutions: 3,
  maxPromptLength: 10_000,
  maxExecutionTimeMs: 600_000,
  maxDailyExecutions: 500,
  maxRetries: 5
} as const
