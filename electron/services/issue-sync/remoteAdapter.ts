// SPDX-License-Identifier: Apache-2.0

/**
 * RemoteAdapter — thin abstraction for communicating with GitHub/GitLab APIs.
 *
 * Each adapter is a pure data translator: API call + response mapping.
 * No business logic, no local DB access.
 */

/** A single issue as fetched from the remote platform. */
export interface RemoteIssue {
  /** Issue number on the remote platform (e.g. GitHub #42). */
  number: number
  title: string
  /** Issue body (markdown). */
  body: string
  /** Raw state string from the platform (e.g. 'open', 'closed'). */
  state: string
  labels: string[]
  /** Full URL to the issue on the remote platform. */
  url: string
  /** ISO 8601 timestamp. */
  createdAt: string
  /** ISO 8601 timestamp. */
  updatedAt: string
}

/** Paginated response for listing remote issues. */
export interface RemoteIssuePage {
  issues: RemoteIssue[]
  /** True if there are more pages to fetch. */
  hasNextPage: boolean
  /** Page number for the next request (GitHub/GitLab page-based pagination). */
  nextPage?: number
  /** Opaque cursor for the next request (Linear cursor-based pagination). */
  nextCursor?: string
}

/** Options for listing remote issues. */
export interface ListRemoteIssuesOptions {
  /** Only return issues updated after this date (incremental sync). */
  since?: Date
  /** 1-based page number (GitHub/GitLab). */
  page?: number
  /** Opaque cursor for cursor-based pagination (Linear). */
  cursor?: string
  /** Results per page (max varies by platform, default 100). */
  perPage?: number
  /** Include closed issues. Default: true (for full sync). */
  state?: 'open' | 'closed' | 'all'
}

/** Connection test result. */
export interface RemoteConnectionResult {
  ok: boolean
  error?: string
}

// ─── Phase 2: Write-side types ──────────────────────────────────────────

/** Input for creating a new issue on the remote platform. */
export interface CreateRemoteIssueInput {
  title: string
  /** Markdown body. */
  body: string
  labels?: string[]
  assignees?: string[]
  milestone?: number // milestone ID
}

/** Input for updating an existing issue on the remote platform. */
export interface UpdateRemoteIssueInput {
  title?: string
  /** Markdown body. */
  body?: string
  labels?: string[]
  assignees?: string[]
  milestone?: number | null
}

/** A comment on a remote issue. */
export interface RemoteComment {
  /** Platform-specific comment ID (string for portability). */
  id: string
  body: string
  authorLogin: string
  authorName: string
  authorAvatar: string
  /** ISO 8601 timestamp. */
  createdAt: string
  /** ISO 8601 timestamp. */
  updatedAt: string
}

/** Paginated response for listing remote comments. */
export interface RemoteCommentPage {
  comments: RemoteComment[]
  hasNextPage: boolean
  nextPage?: number
}

// ─── Adapter interfaces ─────────────────────────────────────────────────

/**
 * Interface that each platform adapter must implement.
 *
 * Adapters are stateless — all configuration is passed via constructor.
 */
export interface RemoteAdapter {
  /** Human-readable label for logging (e.g. 'github:owner/repo'). */
  readonly label: string

  /** List issues with pagination. */
  listIssues(opts?: ListRemoteIssuesOptions): Promise<RemoteIssuePage>

  /** Fetch a single issue by number. */
  getIssue(number: number): Promise<RemoteIssue>

  /** Validate the token and repo access. */
  testConnection(): Promise<RemoteConnectionResult>
}

/**
 * Extended adapter interface for bidirectional sync (Phase 2).
 *
 * Adds write operations: create/update/close/reopen issues and manage comments.
 * Adapters that only support read can implement RemoteAdapter alone.
 */
export interface RemoteWriteAdapter extends RemoteAdapter {
  /** Create a new issue on the remote platform. Returns the created issue. */
  createIssue(input: CreateRemoteIssueInput): Promise<RemoteIssue>

  /** Update an existing issue. Returns the updated issue. */
  updateIssue(number: number, input: UpdateRemoteIssueInput): Promise<RemoteIssue>

  /** Close an issue. */
  closeIssue(number: number): Promise<void>

  /** Reopen a previously closed issue. */
  reopenIssue(number: number): Promise<void>

  /** Create a comment on an issue. Returns the created comment. */
  createComment(issueNumber: number, body: string): Promise<RemoteComment>

  /** List comments on an issue with pagination. */
  listComments(issueNumber: number, opts?: { page?: number; perPage?: number; since?: Date }): Promise<RemoteCommentPage>
}
