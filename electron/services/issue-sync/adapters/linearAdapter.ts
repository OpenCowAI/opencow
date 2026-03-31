// SPDX-License-Identifier: Apache-2.0

import { LinearClient, LinearDocument } from '@linear/sdk'
import type {
  RemoteWriteAdapter,
  RemoteIssue,
  RemoteIssuePage,
  ListRemoteIssuesOptions,
  RemoteConnectionResult,
  CreateRemoteIssueInput,
  UpdateRemoteIssueInput,
  RemoteComment,
  RemoteCommentPage,
} from '../remoteAdapter'

// ─── Internal types ──────────────────────────────────────────────────────

/** Cached workflow state info for status mapping. */
interface WorkflowStateInfo {
  id: string
  name: string
  /** Category: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' */
  type: string
  position: number
  color: string
}

/**
 * Linear adapter using the official `@linear/sdk` TypeScript SDK.
 *
 * Linear's data model differs from GitHub/GitLab in key ways:
 * - **Pagination**: Relay Connection (cursor-based) instead of page numbers
 * - **Status**: N custom WorkflowStates per Team with 5 fixed categories
 * - **Identifier**: String "ENG-42" instead of integer number
 * - **Priority**: 0-4 numeric scale
 * - **Assignee**: Single person (not multi)
 *
 * The adapter handles all of these differences transparently behind the
 * RemoteWriteAdapter interface.
 */
export class LinearAdapter implements RemoteWriteAdapter {
  readonly label: string
  private readonly client: LinearClient
  private readonly teamId: string
  private readonly teamKey: string

  /** Cached WorkflowStates — loaded lazily on first use, then reused. */
  private workflowStatesCache: Map<string, WorkflowStateInfo> | null = null

  /** Cached mapping: issue number → Linear issue UUID (for write operations). */
  private issueIdCache = new Map<number, string>()

  /** Cached team labels: lowercased name → label ID. Loaded lazily. */
  private labelsCache: Map<string, string> | null = null

  constructor(opts: {
    teamId: string
    /** Team key prefix (e.g., "ENG"), used for display label. */
    teamKey: string
    token: string
    /** Whether token is a personal API key or OAuth access token. */
    tokenType?: 'apiKey' | 'accessToken'
  }) {
    this.teamId = opts.teamId
    this.teamKey = opts.teamKey
    this.label = `linear:${opts.teamKey}`

    this.client = new LinearClient(
      opts.tokenType === 'accessToken'
        ? { accessToken: opts.token }
        : { apiKey: opts.token },
    )
  }

  // ─── Read Operations ────────────────────────────────────────────────────

  async listIssues(opts?: ListRemoteIssuesOptions): Promise<RemoteIssuePage> {
    // Linear GraphQL API caps `first` at 50 for issues queries
    const first = Math.min(opts?.perPage ?? 50, 50)

    // Build Linear filter
    const filter: Record<string, unknown> = {
      team: { id: { eq: this.teamId } },
    }
    if (opts?.since) {
      filter.updatedAt = { gte: opts.since.toISOString() }
    }
    if (opts?.state === 'open') {
      filter.state = { type: { nin: ['completed', 'canceled'] } }
    } else if (opts?.state === 'closed') {
      filter.state = { type: { in: ['completed', 'canceled'] } }
    }
    // 'all' → no state filter (default)

    let result
    try {
      result = await this.client.issues({
        first,
        after: opts?.cursor ?? undefined,
        orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
        filter,
      })
    } catch (err: unknown) {
      // Log full error details to diagnose GraphQL validation errors
      console.error('[LinearAdapter] listIssues failed — teamId:', this.teamId)
      const linearErr = err as { type?: string; errors?: Array<{ message?: string; extensions?: unknown }> }
      if (linearErr.type) console.error('[LinearAdapter] Error type:', linearErr.type)
      if (linearErr.errors) {
        console.error('[LinearAdapter] GraphQL errors:', JSON.stringify(linearErr.errors, null, 2))
      }
      console.error('[LinearAdapter] Query variables:', JSON.stringify({ first, after: opts?.cursor, filter }, null, 2))
      throw err
    }

    // Resolve each issue's state (SDK returns lazy Promise references)
    const issues: RemoteIssue[] = await Promise.all(
      result.nodes.map(async (node) => this.mapLinearIssue(node)),
    )

    return {
      issues,
      hasNextPage: result.pageInfo.hasNextPage,
      nextPage: undefined, // Linear uses cursor, not page numbers
      nextCursor: result.pageInfo.endCursor,
    }
  }

  async getIssue(number: number): Promise<RemoteIssue> {
    // Linear uses "number" (the numeric part of identifier like "ENG-42")
    const result = await this.client.issues({
      first: 1,
      filter: {
        team: { id: { eq: this.teamId } },
        number: { eq: number },
      },
    })

    if (result.nodes.length === 0) {
      throw new Error(`Linear issue ${this.teamKey}-${number} not found`)
    }

    return this.mapLinearIssue(result.nodes[0])
  }

  async testConnection(): Promise<RemoteConnectionResult> {
    try {
      const viewer = await this.client.viewer
      if (!viewer) return { ok: false, error: 'Unable to authenticate with Linear' }

      // Also verify the team exists and is accessible
      const team = await this.client.team(this.teamId)
      if (!team) return { ok: false, error: `Team ${this.teamKey} not found or not accessible` }

      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ─── Write Operations ───────────────────────────────────────────────────

  async createIssue(input: CreateRemoteIssueInput): Promise<RemoteIssue> {
    const stateId = await this.getDefaultStateId('unstarted')

    const payload = await this.client.createIssue({
      teamId: this.teamId,
      title: input.title,
      description: input.body,
      stateId,
      ...(input.labels && input.labels.length > 0
        ? { labelIds: await this.resolveLabels(input.labels) }
        : {}),
      ...(input.assignees && input.assignees.length > 0
        ? { assigneeId: input.assignees[0] } // Linear only supports single assignee
        : {}),
    })

    if (!payload.success) throw new Error('Failed to create Linear issue')
    const created = await payload.issue
    if (!created) throw new Error('Created issue not returned from Linear')
    return this.mapLinearIssue(created)
  }

  async updateIssue(number: number, input: UpdateRemoteIssueInput): Promise<RemoteIssue> {
    const issueId = await this.resolveIssueId(number)
    const updates: Record<string, unknown> = {}

    if (input.title !== undefined) updates.title = input.title
    if (input.body !== undefined) updates.description = input.body
    if (input.labels !== undefined) {
      updates.labelIds = await this.resolveLabels(input.labels)
    }
    if (input.assignees !== undefined) {
      updates.assigneeId = input.assignees.length > 0 ? input.assignees[0] : null
    }

    const payload = await this.client.updateIssue(issueId, updates)
    if (!payload.success) throw new Error('Failed to update Linear issue')
    const updated = await payload.issue
    if (!updated) throw new Error('Updated issue not returned from Linear')
    return this.mapLinearIssue(updated)
  }

  async closeIssue(number: number): Promise<void> {
    const issueId = await this.resolveIssueId(number)
    const stateId = await this.getDefaultStateId('completed')
    const payload = await this.client.updateIssue(issueId, { stateId })
    if (!payload.success) throw new Error('Failed to close Linear issue')
  }

  async reopenIssue(number: number): Promise<void> {
    const issueId = await this.resolveIssueId(number)
    const stateId = await this.getDefaultStateId('unstarted')
    const payload = await this.client.updateIssue(issueId, { stateId })
    if (!payload.success) throw new Error('Failed to reopen Linear issue')
  }

  async createComment(issueNumber: number, body: string): Promise<RemoteComment> {
    const issueId = await this.resolveIssueId(issueNumber)
    const payload = await this.client.createComment({ issueId, body })
    if (!payload.success) throw new Error('Failed to create comment on Linear issue')
    const comment = await payload.comment
    if (!comment) throw new Error('Created comment not returned from Linear')
    return this.mapLinearComment(comment)
  }

  async listComments(
    issueNumber: number,
    opts?: { page?: number; perPage?: number; since?: Date },
  ): Promise<RemoteCommentPage> {
    const issueId = await this.resolveIssueId(issueNumber)
    const issue = await this.client.issue(issueId)
    const result = await issue.comments({
      first: opts?.perPage ?? 100,
      orderBy: LinearDocument.PaginationOrderBy.CreatedAt,
    })

    const comments: RemoteComment[] = await Promise.all(
      result.nodes.map(async (node) => this.mapLinearComment(node)),
    )

    // Filter by `since` if provided (Linear doesn't support since filter on comments natively)
    const filteredComments = opts?.since
      ? comments.filter((c) => new Date(c.createdAt) >= opts.since!)
      : comments

    return {
      comments: filteredComments,
      hasNextPage: result.pageInfo.hasNextPage,
      nextPage: undefined, // cursor-based
    }
  }

  // ─── WorkflowState helpers ──────────────────────────────────────────────

  /** Load and cache the Team's WorkflowStates. */
  private async ensureWorkflowStates(): Promise<Map<string, WorkflowStateInfo>> {
    if (this.workflowStatesCache) return this.workflowStatesCache

    const team = await this.client.team(this.teamId)
    const states = await team.states()

    this.workflowStatesCache = new Map()
    for (const s of states.nodes) {
      this.workflowStatesCache.set(s.id, {
        id: s.id,
        name: s.name,
        type: s.type, // category: backlog/unstarted/started/completed/canceled
        position: s.position,
        color: s.color,
      })
    }
    return this.workflowStatesCache
  }

  /** Find the default (lowest position) state ID for a given category. */
  private async getDefaultStateId(category: string): Promise<string> {
    const states = await this.ensureWorkflowStates()
    const candidates = [...states.values()]
      .filter((s) => s.type === category)
      .sort((a, b) => a.position - b.position)

    if (candidates.length === 0) {
      throw new Error(`No workflow state found for category '${category}' in team ${this.teamKey}`)
    }
    return candidates[0].id
  }

  // ─── Issue ID resolution ────────────────────────────────────────────────

  /**
   * Resolve a local issue number to a Linear issue UUID.
   * Linear's API requires UUIDs for write operations but we store the numeric
   * part of the identifier (e.g., 42 from "ENG-42") as `remoteNumber`.
   *
   * Note: The cache is per-adapter-instance. Since AdapterRegistry creates a
   * fresh adapter for each PushEngine entry, the cache is only effective within
   * a single SyncEngine pull cycle (where the same adapter processes all pages).
   * For PushEngine writes, this will make one extra API call per entry.
   * TODO: Store Linear UUID in Issue.remoteId to avoid this runtime resolution.
   */
  private async resolveIssueId(number: number): Promise<string> {
    const cached = this.issueIdCache.get(number)
    if (cached) return cached

    const result = await this.client.issues({
      first: 1,
      filter: {
        team: { id: { eq: this.teamId } },
        number: { eq: number },
      },
    })

    if (result.nodes.length === 0) {
      throw new Error(`Linear issue ${this.teamKey}-${number} not found`)
    }

    const id = result.nodes[0].id
    this.issueIdCache.set(number, id)
    return id
  }

  // ─── Label resolution ───────────────────────────────────────────────────

  /** Load and cache the Team's labels. */
  private async ensureLabelsCache(): Promise<Map<string, string>> {
    if (this.labelsCache) return this.labelsCache

    const team = await this.client.team(this.teamId)
    const labels = await team.labels()

    this.labelsCache = new Map()
    for (const label of labels.nodes) {
      this.labelsCache.set(label.name.toLowerCase(), label.id)
    }
    return this.labelsCache
  }

  /**
   * Resolve label names to Linear label IDs.
   * Uses cached labels (loaded once per adapter lifetime).
   * We match by name (case-insensitive).
   */
  private async resolveLabels(labelNames: string[]): Promise<string[]> {
    if (labelNames.length === 0) return []

    const nameToId = await this.ensureLabelsCache()

    // Only return IDs for labels that exist — don't create missing labels
    return labelNames
      .map((name) => nameToId.get(name.toLowerCase()))
      .filter((id): id is string => id !== undefined)
  }

  // ─── Mapping helpers ────────────────────────────────────────────────────

  /**
   * Map a Linear SDK issue node to our RemoteIssue interface.
   * Must resolve lazy properties (state, assignee) via await.
   */
  private async mapLinearIssue(node: {
    id: string
    number: number
    identifier: string
    title: string
    description?: string | null | undefined
    url: string
    createdAt: Date
    updatedAt: Date
    state: Promise<{ id: string; name: string; type: string }> | { id: string; name: string; type: string }
    labels: () => Promise<{ nodes: Array<{ name: string }> }>
  }): Promise<RemoteIssue> {
    // Resolve the state (may be a lazy Promise from the SDK)
    const state = await Promise.resolve(node.state)

    // Cache the issue ID for later write operations
    this.issueIdCache.set(node.number, node.id)

    // Resolve labels
    let labelNames: string[] = []
    try {
      const labelsResult = await node.labels()
      labelNames = labelsResult.nodes.map((l) => l.name)
    } catch {
      // Labels resolution can fail if the issue was just created; not critical
    }

    return {
      number: node.number,
      title: node.title,
      body: node.description ?? '',
      state: state.type, // category: backlog/unstarted/started/completed/canceled
      labels: labelNames,
      url: node.url,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    }
  }

  /**
   * Map a Linear SDK comment node to our RemoteComment interface.
   */
  private async mapLinearComment(node: {
    id: string
    body: string
    createdAt: Date
    updatedAt: Date
    user?: Promise<{ id: string; name: string; displayName: string; avatarUrl?: string | null } | undefined> | { id: string; name: string; displayName: string; avatarUrl?: string | null } | null
  }): Promise<RemoteComment> {
    let authorLogin = ''
    let authorName = ''
    let authorAvatar = ''

    try {
      const user = await Promise.resolve(node.user)
      if (user) {
        authorLogin = user.id
        authorName = user.displayName || user.name
        authorAvatar = user.avatarUrl ?? ''
      }
    } catch {
      // User resolution can fail; not critical
    }

    return {
      id: node.id,
      body: node.body,
      authorLogin,
      authorName,
      authorAvatar,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    }
  }
}
