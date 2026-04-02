// SPDX-License-Identifier: Apache-2.0

/**
 * Kysely table type definitions for OpenCow SQLite database.
 *
 * Naming convention: snake_case columns, matching SQLite convention.
 * JSON-serialised columns are typed as `string` — callers must parse/stringify.
 */

// ─── Issues ──────────────────────────────────────────────────────────────

export interface IssueTable {
  id: string
  title: string
  description: string
  /** TipTap document JSON — preserves slash mention nodes for lossless round-trip. NULL for legacy plain-text issues. */
  rich_content: string | null
  status: string // IssueStatus: 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled'
  priority: string // IssuePriority: 'urgent' | 'high' | 'medium' | 'low'
  labels: string // JSON array: string[]
  project_id: string | null
  session_id: string | null
  session_history: string // JSON array: string[]
  parent_issue_id: string | null
  images: string // JSON array: IssueImage[]
  created_at: number
  updated_at: number
  read_at: number | null
  last_agent_activity_at: number | null
  /** FK → issue_providers.id; NULL for local-only issues */
  provider_id: string | null
  /** Remote issue number (e.g. GitHub #42) */
  remote_number: number | null
  /** Full URL to the remote issue */
  remote_url: string | null
  /** Raw remote state string (e.g. 'open', 'closed') */
  remote_state: string | null
  /** Epoch ms when last synced from remote */
  remote_synced_at: number | null
  // Phase 2 fields
  /** JSON: IssueAssignee[] */
  assignees: string | null
  /** JSON: IssueMilestone */
  milestone: string | null
  /** 'synced' | 'local_ahead' | 'conflict' | NULL */
  sync_status: string | null
  /** Epoch ms of remote issue's updated_at (for conflict detection) */
  remote_updated_at: number | null
}

export interface CustomLabelTable {
  label: string
}

// ─── Inbox ───────────────────────────────────────────────────────────────

export interface InboxMessageTable {
  id: string
  category: string // 'hook_event' | 'smart_reminder'
  status: string // InboxMessageStatus: 'unread' | 'read' | 'archived'
  // Denormalised fields for indexed queries
  event_type: string | null // HookEventType (hook_event only)
  reminder_type: string | null // SmartReminderType (smart_reminder only)
  project_id: string | null // hook_event.projectId or smart_reminder context
  session_id: string | null // hook_event.sessionId
  route_kind: string | null // InboxNavigationTarget.kind
  route_issue_id: string | null
  route_session_id: string | null
  route_schedule_id: string | null
  // Full message as JSON for lossless round-trip
  payload: string // JSON: HookEventMessage | SmartReminderMessage
  created_at: number
  read_at: number | null
  archived_at: number | null
}

// ─── Managed Sessions ────────────────────────────────────────────────────

export interface ManagedSessionTable {
  id: string
  sdk_session_id: string | null
  /** Engine kind for this session row — 'claude' by default; 'codex' for Codex sessions. */
  engine_kind: string
  /** Engine-specific serialized checkpoint/thread state. */
  engine_state_json: string | null
  state: string // ManagedSessionState
  stop_reason: string | null // SessionStopReason
  /** SessionOrigin.source — 'agent' | 'issue' | 'telegram' | 'schedule' | 'hook' */
  origin_source: string
  /**
   * SessionOrigin primary context ID:
   *   issue          → issueId
   *   telegram       → chatId  (reply-routing key; changed from botId in m017)
   *   schedule       → scheduleId
   *   hook           → webhookId
   *   agent / browser-agent → NULL
   */
  origin_id: string | null
  /**
   * SessionOrigin secondary context ID (added in migration 017).
   * Currently only used by 'telegram': stores botId for multi-bot support.
   * NULL for all other origin types.
   */
  origin_extra: string | null
  project_path: string | null
  /** Resolved Project ID — domain-level link to the owning project. Added in migration 020. */
  project_id: string | null
  model: string | null
  messages: string // JSON array: ManagedSessionMessage[]
  created_at: number
  last_activity: number
  /** Cumulative active duration in ms (creating/streaming/stopping only). Added in migration 032. */
  active_duration_ms: number
  /** Epoch ms when the session last entered an active state; NULL when inactive. Added in migration 032. */
  active_started_at: number | null
  total_cost_usd: number
  input_tokens: number
  output_tokens: number
  last_input_tokens: number
  activity: string | null
  error: string | null
  /** JSON-serialized SessionExecutionContext; null when not yet initialized. Added in migration 035. */
  execution_context: string | null
}

// ─── Projects ────────────────────────────────────────────────────────────

export interface ProjectTable {
  id: string
  name: string
  canonical_path: string
  default_tab: string
  default_chat_view_mode: string
  default_files_display_mode: string | null
  pin_order: number | null
  archived_at: number | null
  display_order: number
  created_at: number
  updated_at: number
}

export interface ProjectClaudeMappingTable {
  claude_folder_id: string
  project_id: string
  discovered_at: number
}

export interface ProjectExternalMappingTable {
  id: string
  project_id: string
  engine_kind: string
  external_project_ref: string
  discovered_at: number
}

// ─── Session Notes ──────────────────────────────────────────────────────

export interface SessionNoteTable {
  id: string
  issue_id: string
  content: string
  /** TipTap document JSON — preserves slash mention nodes for lossless round-trip. NULL for legacy plain-text notes. */
  rich_content: string | null
  source_file_path: string | null
  images: string // JSON array: IssueImage[]
  created_at: number
  updated_at: number
}

// ─── Artifacts ──────────────────────────────────────────────────────────

export interface ArtifactTable {
  id: string
  kind: string // ArtifactKind: 'file' | 'diagram' | 'image' | 'snippet' | 'card'
  title: string
  mime_type: string
  file_path: string | null
  file_extension: string | null
  session_id: string | null
  issue_id: string | null
  project_id: string | null
  source: string // ArtifactSource: 'managed' | 'monitor' | 'project_file'
  content: string | null
  content_hash: string
  content_length: number
  starred: number // 0 | 1
  starred_at: number | null
  writes: number
  edits: number
  created_at: number
  updated_at: number
}

// ─── Browser Profiles ───────────────────────────────────────────────────

export interface BrowserProfileTable {
  id: string
  name: string
  partition: string
  allowed_domains: string // JSON array: string[]
  cookie_persistence: number // 0 | 1
  created_at: number
  last_used_at: number
}

// ─── Issue Views ────────────────────────────────────────────────────────

export interface IssueViewTable {
  id: string
  name: string
  icon: string
  filters: string // JSON: ViewFilters
  display: string // JSON: ViewDisplayConfig
  position: number
  created_at: number
  updated_at: number
}

// ─── Schedules ─────────────────────────────────────────────────────────

export interface ScheduleTable {
  id: string
  name: string
  description: string
  trigger_config: string
  action_config: string
  priority: string
  failure_policy: string
  missed_policy: string
  concurrency_policy: string
  status: string
  next_run_at: number | null
  last_run_at: number | null
  last_run_status: string | null
  last_run_error: string | null
  start_date: number | null
  end_date: number | null
  max_executions: number | null
  execution_count: number
  consecutive_failures: number
  project_id: string | null
  created_at: number
  updated_at: number
}

export interface ScheduleExecutionTable {
  id: string
  schedule_id: string
  pipeline_id: string | null
  pipeline_step_order: number | null
  trigger_type: string
  trigger_detail: string | null
  status: string
  resolved_prompt: string | null
  session_id: string | null
  issue_id: string | null
  error: string | null
  scheduled_at: number
  started_at: number
  completed_at: number | null
  duration_ms: number | null
  cost_usd: number
  input_tokens: number
  output_tokens: number
}

export interface SchedulePipelineTable {
  id: string
  name: string
  description: string
  steps: string
  failure_policy: string
  status: string
  project_id: string | null
  created_at: number
  updated_at: number
}

// ─── Capability Center ──────────────────────────────────────────────────

export interface CapabilityStateTable {
  scope: string          // 'global' | 'project'
  project_id: string     // '' for global scope (never NULL — v3.1 fix #3)
  category: string       // ManagedCapabilityCategory
  name: string
  enabled: number        // 0 | 1
  tags: string           // JSON array: string[]
  sort_order: number
  created_at: number
  updated_at: number
}

export interface CapabilityDistributionTable {
  category: string
  name: string
  target_type: string    // 'claude-code-global' | 'claude-code-project' | 'codex-global' | 'codex-project'
  target_path: string
  strategy: string       // 'copy' | 'symlink'
  content_hash: string
  distributed_at: number
}

export interface CapabilityImportTable {
  category: string
  name: string
  source_path: string
  source_origin: string  // 'claude-code' | 'codex' | 'plugin' | 'marketplace' | 'template' | 'file' | 'unknown'
  source_hash: string | null
  imported_at: number
  /** Marketplace provenance — added by migration 025 */
  marketplace_id: string | null
  market_slug: string | null
  market_version: string | null
}

export interface CapabilityVersionTable {
  id: number
  category: string
  name: string
  content_hash: string
  snapshot: string       // Full file content snapshot
  created_at: number
}

// ─── Memories ──────────────────────────────────────────────────────────

export interface MemoryTable {
  id: string
  scope: string // 'user' | 'project'
  project_id: string | null
  content: string
  category: string // MemoryCategory
  tags: string // JSON array: string[]
  confidence: number
  source: string // MemorySource
  source_id: string | null
  reasoning: string | null
  status: string // MemoryStatus
  confirmed_by: string | null // 'user' | 'auto'
  version: number
  previous_id: string | null
  access_count: number
  last_accessed_at: number | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

export interface MemoryHistoryTable {
  id: string
  memory_id: string
  event: string // 'created' | 'updated' | 'confirmed' | 'rejected' | 'archived' | 'deleted' | 'merged'
  previous_content: string | null
  new_content: string | null
  actor: string // 'user' | 'auto' | 'ai_synthesis' | 'system'
  source: string | null
  created_at: number
}

export interface MemorySettingsTable {
  project_id: string // '' for global defaults
  enabled: number // 0 | 1
  auto_confirm: number // 0 | 1
  confirm_timeout_seconds: number
  extraction_delay_seconds: number
  extraction_sources: string // JSON array: MemorySource[]
  max_memories: number
  auto_archive_days: number
  updated_at: number
}

// ─── Issue Change Queue ──────────────────────────────────────────────────

export interface IssueChangeQueueTable {
  id: string
  local_issue_id: string
  provider_id: string
  /** 'create' | 'update' | 'close' | 'reopen' | 'comment' */
  operation: string
  /** JSON: full field snapshot for idempotent replay */
  payload: string
  /** 'pending' | 'processing' | 'completed' | 'failed' */
  status: string
  retry_count: number
  max_retries: number
  error_message: string | null
  created_at: number
  processed_at: number | null
}

// ─── Issue Comments ─────────────────────────────────────────────────────

export interface IssueCommentTable {
  id: string
  issue_id: string
  provider_id: string | null
  /** Remote comment ID from GitHub/GitLab (null for local-only) */
  remote_id: string | null
  author_login: string | null
  author_name: string | null
  author_avatar: string | null
  body: string
  /** 'markdown' | 'tiptap' */
  body_format: string
  /** 0 | 1 */
  is_local: number
  created_at: number
  updated_at: number
  synced_at: number | null
}

// ─── Issue Sync Logs ────────────────────────────────────────────────────

export interface IssueSyncLogTable {
  id: string
  provider_id: string
  /** 'pull' | 'push' | 'full' */
  sync_type: string
  /** 'running' | 'success' | 'partial' | 'failed' */
  status: string
  issues_created: number
  issues_updated: number
  issues_failed: number
  comments_synced: number
  conflicts: number
  error_message: string | null
  started_at: number
  completed_at: number | null
  duration_ms: number | null
}

// ─── Database schema ─────────────────────────────────────────────────────

export interface Database {
  issues: IssueTable
  issue_providers: IssueProviderTable
  issue_change_queue: IssueChangeQueueTable
  issue_comments: IssueCommentTable
  issue_sync_logs: IssueSyncLogTable
  custom_labels: CustomLabelTable
  inbox_messages: InboxMessageTable
  managed_sessions: ManagedSessionTable
  projects: ProjectTable
  project_claude_mappings: ProjectClaudeMappingTable
  project_external_mappings: ProjectExternalMappingTable
  artifacts: ArtifactTable
  session_notes: SessionNoteTable
  browser_profiles: BrowserProfileTable
  issue_views: IssueViewTable
  schedules: ScheduleTable
  schedule_executions: ScheduleExecutionTable
  schedule_pipelines: SchedulePipelineTable
  issue_context_refs: IssueContextRefTable
  capability_state: CapabilityStateTable
  capability_distribution: CapabilityDistributionTable
  capability_import: CapabilityImportTable
  capability_version: CapabilityVersionTable
  installed_packages: InstalledPackageTable
  repo_sources: RepoSourceTable
  repo_source_sync: RepoSourceSyncTable
  memories: MemoryTable
  memory_history: MemoryHistoryTable
  memory_settings: MemorySettingsTable
}

// ─── Installed Packages ──────────────────────────────────────────────────

export interface InstalledPackageTable {
  /** UUID */
  id: string
  /** Package namespace prefix (e.g. "superpowers") — unique within scope+project */
  prefix: string
  /** 'global' | 'project' */
  scope: string
  /** Project ID (UUID) — empty string '' for global scope */
  project_id: string
  /** Marketplace ID (e.g. "github", "skills.sh") */
  marketplace_id: string
  /** Marketplace slug (e.g. "obra/superpowers") */
  slug: string
  /** Installed version (semver or commit SHA) */
  version: string
  /** Repository URL */
  repo_url: string
  /** Author name */
  author: string
  /** JSON: Record<ManagedCapabilityCategory, string[]> — capabilities discovered at install time */
  capabilities: string
  /** SHA-256 hash of installed content for integrity verification */
  content_hash: string
  /** Epoch ms — when first installed */
  installed_at: number
  /** Epoch ms — last updated (reinstall/update) */
  updated_at: number
}

// ─── Repo Sources ───────────────────────────────────────────────────────

export interface RepoSourceTable {
  /** nanoid */
  id: string
  /** User display name */
  name: string
  /** Repository URL (e.g. https://github.com/owner/repo) */
  url: string
  /** 'github' | 'gitlab' */
  platform: string
  /** Branch override (NULL = default branch) */
  branch: string | null
  /** Key reference into CredentialStore (no plaintext secrets in DB) */
  credential_key: string | null
  /** 0 | 1 */
  enabled: number
  created_at: number
  updated_at: number
}

export interface RepoSourceSyncTable {
  /** FK → repo_sources.id (cascading delete) */
  source_id: string
  /** 'idle' | 'syncing' | 'error' */
  status: string
  last_synced_at: number | null
  last_commit: string | null
  error_message: string | null
}

// ─── Issue Providers ─────────────────────────────────────────────────────

export interface IssueProviderTable {
  id: string
  project_id: string
  /** 'github' | 'gitlab' */
  platform: string
  repo_owner: string
  repo_name: string
  /** Custom API base URL for GitLab self-hosted; NULL for cloud defaults */
  api_base_url: string | null
  /** Key reference into CredentialStore — never plaintext */
  auth_token_ref: string
  /** 'keychain' | 'encrypted' */
  auth_storage: string
  /** 0 | 1 */
  sync_enabled: number
  sync_interval_s: number
  last_synced_at: number | null
  // Phase 2 fields
  /** 'readonly' | 'push' | 'bidirectional' */
  sync_direction: string
  /** Opaque cursor for incremental sync */
  sync_cursor: string | null
  /** Platform-specific metadata as JSON (e.g., Linear teamId, teamKey, cached WorkflowStates) */
  metadata: string | null
  created_at: number
  updated_at: number
}

// ─── Issue Context Refs ──────────────────────────────────────────────────

export interface IssueContextRefTable {
  id: string
  issue_id: string
  ref_type: string   // 'issue' | 'artifact'
  ref_id: string
  created_at: number
}
