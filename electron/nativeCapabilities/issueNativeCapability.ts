// SPDX-License-Identifier: Apache-2.0

/**
 * IssueNativeCapability — OpenCow built-in native capability for Issue management.
 *
 * Exposes 4 MCP tools that allow Claude to manage Issues on behalf of the user:
 *   list_issues    — filter, sort, paginate issue list (IssueQueryFilter full support)
 *   get_issue      — retrieve full details of a single issue + direct child issues
 *   create_issue   — create a new issue (sessionId + projectId auto-bound from session context)
 *   update_issue   — update title / description / status / priority / labels / projectId / parentIssueId
 *
 * delete_issue is intentionally omitted — AI agents should not hold irreversible
 * destructive power. Use the OpenCow UI to delete issues.
 *
 * Key design decisions:
 *   - NativeCapabilitySessionContext is bound into tool closures (not exposed as params)
 *   - create_issue uses three-value projectId semantics:
 *       undefined = use session's projectId (auto-link to current project)
 *       null      = explicitly no project
 *       "id"      = link to specific project
 *   - Tool descriptions are dynamically generated based on session context
 *   - priority sorting is done in-memory (Store ORDER BY priority is lexicographic — wrong)
 *   - labels filter is OR semantics (store uses `value IN (...)`)
 *   - timestamps serialised as ISO 8601 strings
 *   - pagination: limit + offset (memory-level slice) + hasMore flag
 *
 * Tool handlers run in-process (Electron main), directly calling IssueService.
 * No extra process, no network round-trips.
 */

import { z } from 'zod/v4'
import type { NativeCapabilityMeta, NativeCapabilityToolContext, NativeCapabilitySessionContext } from './types'
import { BaseNativeCapability, type ToolConfig, resolveProposalToolUseId } from './baseNativeCapability'
import type { IssueService } from '../services/issueService'
import type { IssueProviderService } from '../services/issueProviderService'
import type { AdapterRegistry } from '../services/issue-sync/adapterRegistry'
import type { LifecycleOperationCoordinator } from '../services/lifecycleOperations'
import type {
  Issue,
  IssuePriority,
  SessionLifecycleOperationProposalInput,
} from '../../src/shared/types'

// ─── Dependencies ─────────────────────────────────────────────────────────────

export interface IssueNativeCapabilityDeps {
  issueService: IssueService
  /** Optional — when provided, remote issue tools are enabled. */
  issueProviderService?: IssueProviderService
  adapterRegistry?: AdapterRegistry
  lifecycleOperationCoordinator?: LifecycleOperationCoordinator
}

// ─── Text normalisation ──────────────────────────────────────────────────────

/**
 * Normalise literal escape sequences that LLMs commonly produce in tool call strings.
 *
 * When generating JSON tool inputs, models sometimes emit `\\n` (two characters:
 * backslash + n) instead of `\n` (the JSON newline escape). After JSON parsing,
 * this becomes the literal text `\n` instead of an actual newline character.
 *
 * This function converts those literal sequences back to the characters they represent.
 * Safe to apply unconditionally — actual newline/tab characters are single-byte (0x0A / 0x09)
 * and will never match the two-character regex patterns.
 */
function normaliseLlmText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

function normalizeConfirmationMode(
  value: unknown
): SessionLifecycleOperationProposalInput['confirmationMode'] | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (normalized === 'required') return 'required'
  if (normalized === 'auto_if_user_explicit' || normalized === 'auto_if_explicit') {
    return 'auto_if_user_explicit'
  }
  if (normalized === 'draft') return 'required'
  return undefined
}

// ─── Serialisation constants ───────────────────────────────────────────────────

/** Maximum issues returned by list_issues (prevents flooding Claude's context). */
const LIST_MAX = 100
const LIST_DEFAULT = 30

// ─── Priority semantic sort order ─────────────────────────────────────────────

/**
 * Semantic priority ordering: urgent (most important) → low (least important).
 *
 * The Store sorts priority alphabetically (h < l < m < u) which is semantically
 * incorrect. This map is used to sort in native capability memory after fetching all results.
 */
const PRIORITY_ORDER: Record<IssuePriority, number> = {
  urgent: 0,
  high:   1,
  medium: 2,
  low:    3,
}

// ─── IssueNativeCapability ────────────────────────────────────────────────────

export class IssueNativeCapability extends BaseNativeCapability {
  readonly meta: NativeCapabilityMeta = {
    category: 'issues',
    name: 'Issues',
    description: 'OpenCow Issue management — list, read, create and update issues',
    version: '3.0.0',
  }

  private readonly issueService: IssueService
  private readonly issueProviderService: IssueProviderService | null
  private readonly adapterRegistry: AdapterRegistry | null
  private readonly lifecycleOperationCoordinator: LifecycleOperationCoordinator | null

  constructor(deps: IssueNativeCapabilityDeps) {
    super()
    this.issueService = deps.issueService
    this.issueProviderService = deps.issueProviderService ?? null
    this.adapterRegistry = deps.adapterRegistry ?? null
    this.lifecycleOperationCoordinator = deps.lifecycleOperationCoordinator ?? null
  }

  protected toolConfigs(context: NativeCapabilityToolContext): ToolConfig[] {
    const session = context.session
    const configs: ToolConfig[] = [
      this.listIssuesConfig(session),
      this.getIssueConfig(),
      this.proposeIssueOperationConfig(session),
      this.createIssueConfig(session),
      this.updateIssueConfig(),
    ]

    // Phase 3: Remote issue tools (only when provider infrastructure is available)
    if (this.issueProviderService && this.adapterRegistry) {
      configs.push(
        this.searchRemoteIssuesConfig(),
        this.getRemoteIssueConfig(),
        this.commentRemoteIssueConfig(),
      )
    }

    return configs
  }

  // ── list_issues ─────────────────────────────────────────────────────────────

  private listIssuesConfig(session: NativeCapabilitySessionContext): ToolConfig {
    const projectHint = session.projectId
      ? ` Your current project ID is "${session.projectId}" — use the projectId filter to scope results to this project.`
      : ''

    return {
      name: 'list_issues',
      description:
        'List OpenCow issues with rich filtering, sorting, and pagination. ' +
        'Returns a compact summary of each issue (no description, no image data). ' +
        'Use get_issue to retrieve full details of a specific issue. ' +
        `Defaults to ${LIST_DEFAULT} results per page; maximum is ${LIST_MAX}. ` +
        'Labels filter uses OR semantics — issues matching ANY of the specified labels are returned.' +
        projectHint,
      schema: {
        statuses: z
          .array(z.enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled']))
          .optional()
          .describe('Filter by one or more statuses (OR semantics)'),
        priorities: z
          .array(z.enum(['urgent', 'high', 'medium', 'low']))
          .optional()
          .describe('Filter by one or more priorities (OR semantics)'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Filter by labels — issues matching ANY of the given labels are returned (OR semantics)'),
        projectId: z
          .string()
          .optional()
          .describe('Filter by project ID'),
        search: z
          .string()
          .optional()
          .describe('Full-text search across title and description'),
        hasSession: z
          .boolean()
          .optional()
          .describe('true = only issues that have been associated with a session at some point; false = only sessionless issues'),
        updatedAfter: z
          .string()
          .optional()
          .describe('ISO 8601 date-time string — return issues updated after this point (e.g. "2024-03-01T00:00:00Z")'),
        updatedBefore: z
          .string()
          .optional()
          .describe('ISO 8601 date-time string — return issues updated before this point'),
        createdAfter: z
          .string()
          .optional()
          .describe('ISO 8601 date-time string — return issues created after this point'),
        sortBy: z
          .enum(['createdAt', 'updatedAt', 'status', 'priority'])
          .default('updatedAt')
          .describe(
            'Sort field. "priority" uses semantic order (urgent > high > medium > low) ' +
            'applied in memory after fetching. Other fields use database-level sorting.',
          ),
        sortOrder: z
          .enum(['asc', 'desc'])
          .default('desc')
          .describe('Sort direction. For priority: desc = urgent first; asc = low first'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_MAX)
          .default(LIST_DEFAULT)
          .describe(`Maximum number of issues to return per page (1–${LIST_MAX}, default ${LIST_DEFAULT})`),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Number of issues to skip (for pagination). Use with limit.'),
      },
      execute: async (args) => {
        const sortBy    = (args.sortBy    as string) ?? 'updatedAt'
        const sortOrder = (args.sortOrder as 'asc' | 'desc') ?? 'desc'
        const limit     = (args.limit     as number) ?? LIST_DEFAULT
        const offset    = (args.offset    as number) ?? 0

        // Build IssueQueryFilter — omit sort when doing priority in-memory sort
        const filter: Record<string, unknown> = {}
        if (args.statuses   ) filter.statuses    = args.statuses
        if (args.priorities ) filter.priorities  = args.priorities
        if (args.labels     ) filter.labels      = args.labels
        if (args.projectId  ) filter.projectId   = args.projectId
        if (args.search     ) filter.search      = args.search
        if (args.hasSession !== undefined) filter.hasSession = args.hasSession

        // Convert ISO 8601 strings → Unix milliseconds for the store
        if (args.updatedAfter ) filter.updatedAfter  = new Date(args.updatedAfter  as string).getTime()
        if (args.updatedBefore) filter.updatedBefore = new Date(args.updatedBefore as string).getTime()
        if (args.createdAfter ) filter.createdAfter  = new Date(args.createdAfter  as string).getTime()

        // Delegate DB-level sorting to the store for non-priority fields
        if (sortBy !== 'priority') {
          filter.sort = { field: sortBy, order: sortOrder }
        }

        const all = await this.issueService.listIssues(filter as Parameters<typeof this.issueService.listIssues>[0])

        // In-memory semantic priority sort (store ORDER BY priority is lexicographic — wrong)
        if (sortBy === 'priority') {
          all.sort((a, b) =>
            sortOrder === 'desc'
              ? PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
              : PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
          )
        }

        const page = all.slice(offset, offset + limit)

        return this.textResult(JSON.stringify({
          total:    all.length,
          returned: page.length,
          offset,
          hasMore:  offset + page.length < all.length,
          issues:   page.map((i) => this.toSummary(i)),
        }, null, 2))
      },
    }
  }

  // ── get_issue ───────────────────────────────────────────────────────────────

  private getIssueConfig(): ToolConfig {
    return {
      name: 'get_issue',
      description:
        'Retrieve the full details of a single OpenCow issue by its ID. ' +
        'Returns title, description, status, priority, labels, projectId, sessionId, ' +
        'creation/update timestamps (ISO 8601), image count, and direct child issues.',
      schema: {
        id: z.string().describe('The issue ID to retrieve'),
      },
      execute: async (args) => {
        const id = args.id as string

        // Fetch issue and its direct children in parallel
        const [issue, children] = await Promise.all([
          this.issueService.getIssue(id),
          this.issueService.listChildIssues(id),
        ])

        if (!issue) {
          return this.errorResult(new Error(`Issue not found: ${id}`))
        }

        return this.textResult(JSON.stringify({
          ...this.toDetail(issue),
          children: children.map((c) => this.toSummary(c)),
        }, null, 2))
      },
    }
  }

  // ── create_issue ────────────────────────────────────────────────────────────

  /**
   * Creates the create_issue tool config with session context bound from NativeCapabilityToolContext.
   *
   * projectId is captured from session context and auto-injected (three-value semantics):
   *   - undefined (not provided) → auto-link to session's project (default behavior)
   *   - null (explicitly null)   → create without any project association
   *   - "proj-xxx" (explicit ID) → link to the specified project
   *
   * sessionId is NOT auto-injected. Issue.sessionId represents the session that is
   * actively *working on* the issue (started from the Issue detail view), not the
   * chat session that happened to create it. A chat creating an issue is just the
   * "creator", not the "assignee".
   */
  private createIssueConfig(session: NativeCapabilitySessionContext): ToolConfig {
    const projectHint = session.projectId
      ? ' When called from a project context, the issue is automatically linked ' +
        'to the current project unless you explicitly set projectId to null or a different ID.'
      : ''

    return {
      name: 'create_issue',
      description:
        'Create a new OpenCow issue. Extract the title and priority from the user\'s ' +
        'description. If the information is clear, create immediately; otherwise ask the ' +
        'user to clarify before calling this tool. ' +
        'The issue will be automatically linked to the current project context (if any). ' +
        'IMPORTANT: Only call this tool when the user explicitly asks to create an issue. ' +
        'Do NOT proactively create issues for problems you discover during work.' +
        projectHint,
      schema: {
        title: z
          .string()
          .describe('Issue title — concise description of the problem or requirement'),
        description: z
          .string()
          .optional()
          .describe('Optional longer description or reproduction steps'),
        priority: z
          .enum(['urgent', 'high', 'medium', 'low'])
          .default('medium')
          .describe('Priority: urgent | high | medium (default) | low'),
        labels: z
          .array(z.string())
          .optional()
          .describe('Labels, e.g. ["bug", "feature"]'),
        status: z
          .enum(['backlog', 'todo'])
          .default('backlog')
          .describe('Initial status: backlog (default) or todo. Cannot create directly as in_progress/done.'),
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Project to associate the issue with. ' +
            'Omit to use the current project context (if any); ' +
            'pass null to explicitly create without a project; ' +
            'pass a project ID to link to a specific project.',
          ),
        parentIssueId: z
          .string()
          .optional()
          .describe('Optional parent issue ID — creates this as a sub-issue'),
      },
      execute: async (args) => {
        // Three-value projectId semantics:
        //   undefined (not provided) → use session's projectId (auto-link to current project)
        //   null (explicitly null)   → no project association
        //   "proj-xxx" (explicit ID) → link to specified project
        const resolvedProjectId = args.projectId === undefined
          ? session.projectId
          : args.projectId as string | null

        const issue = await this.issueService.createIssue({
          title:         normaliseLlmText(args.title as string),
          description:   typeof args.description === 'string' ? normaliseLlmText(args.description) : undefined,
          priority:      args.priority      as 'urgent' | 'high' | 'medium' | 'low',
          labels:        (args.labels       as string[] | undefined) ?? [],
          status:        args.status        as 'backlog' | 'todo',
          projectId:     resolvedProjectId ?? undefined,
          parentIssueId: args.parentIssueId as string | undefined,
          // sessionId intentionally NOT set here. Issue.sessionId represents the
          // session actively *working on* the issue (started from Issue detail view),
          // not the chat session that created it.
        })
        return this.textResult(JSON.stringify(this.toDetail(issue), null, 2))
      },
    }
  }

  // ── propose_issue_operation ────────────────────────────────────────────────

  private proposeIssueOperationConfig(session: NativeCapabilitySessionContext): ToolConfig {
    return {
      name: 'propose_issue_operation',
      description:
        'Propose one or more issue lifecycle operations for in-session governance and execution. ' +
        'Returns { operations: SessionLifecycleOperationEnvelope[], _sessionEntityHints: { entity, action, entityId, name }[] }. ' +
        'For update/transition_status actions, normalizedPayload.id is required — use entityId from _sessionEntityHints or list_issues to retrieve it first.',
      schema: {
        userInstruction: z
          .string()
          .optional()
          .describe('Original user instruction used for explicit no-confirm detection'),
        operations: z
          .array(z.object({
            action: z.enum(['create', 'update', 'transition_status']),
            normalizedPayload: z.record(z.string(), z.unknown()),
            summary: z.record(z.string(), z.unknown()).optional(),
            warnings: z.array(z.string()).optional(),
            confirmationMode: z
              .string()
              .optional()
              .describe('Confirmation mode. Prefer "required" or "auto_if_user_explicit"; legacy "draft" is accepted.'),
            idempotencyKey: z.string().optional(),
          }))
          .min(1)
          .describe('Structured issue lifecycle proposals'),
      },
      execute: async (args, input) => {
        if (!this.lifecycleOperationCoordinator) {
          return this.errorResult(new Error('Lifecycle operation coordinator is not available'))
        }

        const toolUseId = resolveProposalToolUseId(input.context)
        const operationArgs = args.operations as Array<Record<string, unknown>>

        // Validate: update/transition_status operations must include id
        for (const candidate of operationArgs) {
          const action = candidate.action as string
          if (action === 'update' || action === 'transition_status') {
            const payload = candidate.normalizedPayload as Record<string, unknown>
            if (!payload.id || typeof payload.id !== 'string' || payload.id.trim().length === 0) {
              return this.errorResult(new Error(
                `Issue ${action} proposal requires normalizedPayload.id. ` +
                'Use getSessionEntityHints or list_issues to retrieve the issue id first.'
              ))
            }
          }
        }

        const proposals: SessionLifecycleOperationProposalInput[] = operationArgs.map((candidate) => ({
          entity: 'issue',
          action: candidate.action as SessionLifecycleOperationProposalInput['action'],
          normalizedPayload: {
            ...(candidate.normalizedPayload as Record<string, unknown>),
            projectId:
              (candidate.normalizedPayload as Record<string, unknown>)?.projectId === undefined
                ? session.projectId
                : (candidate.normalizedPayload as Record<string, unknown>).projectId,
          },
          summary: candidate.summary as Record<string, unknown> | undefined,
          warnings: candidate.warnings as string[] | undefined,
          confirmationMode: normalizeConfirmationMode(candidate.confirmationMode),
          idempotencyKey: typeof candidate.idempotencyKey === 'string' ? candidate.idempotencyKey : undefined,
          userInstruction: typeof args.userInstruction === 'string' ? args.userInstruction : undefined,
        }))

        const envelopes = await this.lifecycleOperationCoordinator.proposeOperations({
          sessionId: session.sessionId,
          toolUseId,
          toolName: 'propose_issue_operation',
          proposals,
        })

        const entityHints = await this.lifecycleOperationCoordinator.getSessionEntityHints(session.sessionId)
        return this.textResult(JSON.stringify({ operations: envelopes, _sessionEntityHints: entityHints }, null, 2))
      },
    }
  }

  // ── update_issue ────────────────────────────────────────────────────────────

  private updateIssueConfig(): ToolConfig {
    return {
      name: 'update_issue',
      description:
        'Update one or more user-facing fields of an existing OpenCow issue. ' +
        'Only the fields you provide will be changed; omitted fields are left unchanged. ' +
        'Note: labels is a replace operation — passing ["bug"] will overwrite all existing labels. ' +
        'Internal fields (sessionId, images, contextRefs, timestamps) cannot be changed via this tool. ' +
        'IMPORTANT: Only call this tool when the user explicitly asks to update an issue. ' +
        'Do NOT automatically change issue status or other fields on your own initiative.',
      schema: {
        id: z
          .string()
          .describe('ID of the issue to update'),
        title: z
          .string()
          .optional()
          .describe('New title'),
        description: z
          .string()
          .optional()
          .describe('New description (completely replaces the existing description)'),
        status: z
          .enum(['backlog', 'todo', 'in_progress', 'done', 'cancelled'])
          .optional()
          .describe('New status'),
        priority: z
          .enum(['urgent', 'high', 'medium', 'low'])
          .optional()
          .describe('New priority'),
        labels: z
          .array(z.string())
          .optional()
          .describe('New labels array — completely replaces all existing labels (not appended)'),
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe('Move issue to a different project. Pass null to detach from any project.'),
        parentIssueId: z
          .string()
          .nullable()
          .optional()
          .describe('Set or change parent issue. Pass null to make it a top-level issue.'),
      },
      execute: async (args) => {
        const id = args.id as string

        // Build patch with only explicitly supplied user-facing fields.
        // Internal fields (sessionId, images, contextRefs, timestamps) are intentionally excluded.
        const patch: Partial<Issue> = {}
        if (args.title         !== undefined) patch.title         = normaliseLlmText(args.title as string)
        if (args.description   !== undefined) patch.description   = normaliseLlmText(args.description as string)
        if (args.status        !== undefined) patch.status        = args.status        as Issue['status']
        if (args.priority      !== undefined) patch.priority      = args.priority      as Issue['priority']
        if (args.labels        !== undefined) patch.labels        = args.labels        as string[]
        if (args.projectId     !== undefined) patch.projectId     = args.projectId     as string | null
        if (args.parentIssueId !== undefined) patch.parentIssueId = args.parentIssueId as string | null

        if (Object.keys(patch).length === 0) {
          return this.errorResult(new Error(
            'No fields provided to update. Provide at least one of: title, description, status, priority, labels, projectId, parentIssueId.',
          ))
        }

        // Single DB operation — no TOCTOU pre-check.
        // updateIssue returns null if the issue does not exist.
        const updated = await this.issueService.updateIssue(id, patch)
        if (!updated) {
          return this.errorResult(new Error(`Issue not found: ${id}`))
        }

        return this.textResult(JSON.stringify(this.toDetail(updated), null, 2))
      },
    }
  }

  // ── Remote issue tools (Phase 3) ────────────────────────────────────────────

  /**
   * Helper to resolve a provider + adapter from a providerId.
   * Returns null if provider not found or token unavailable.
   */
  private async resolveRemoteAdapter(providerId: string) {
    if (!this.issueProviderService || !this.adapterRegistry) return null
    const provider = await this.issueProviderService.getProvider(providerId)
    if (!provider) return null
    const token = await this.issueProviderService.getToken(provider)
    if (!token) return null
    return { provider, adapter: this.adapterRegistry.createWriteAdapter(provider, token) }
  }

  private searchRemoteIssuesConfig(): ToolConfig {
    return {
      name: 'search_remote_issues',
      description:
        'Search issues on a remote GitHub/GitLab repository. ' +
        'Use this to find issues on the remote platform that may not be synced locally. ' +
        'Results are fetched directly from the remote API. ' +
        'You need a valid providerId — use list_issues to find issues with a providerId, ' +
        'or ask the user which repository to search.',
      schema: {
        providerId: z.string().describe('The issue provider ID (GitHub/GitLab connection)'),
        state: z
          .enum(['open', 'closed', 'all'])
          .default('open')
          .describe('Filter by issue state'),
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe('Page number (1-based)'),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(30)
          .describe('Results per page (max 100)'),
      },
      execute: async (args) => {
        const resolved = await this.resolveRemoteAdapter(args.providerId as string)
        if (!resolved) {
          return this.errorResult(new Error('Provider not found or token unavailable'))
        }

        const result = await resolved.adapter.listIssues({
          state: args.state as 'open' | 'closed' | 'all',
          page: args.page as number,
          perPage: args.perPage as number,
        })

        return this.textResult(JSON.stringify({
          provider: `${resolved.provider.platform}:${resolved.provider.repoOwner}/${resolved.provider.repoName}`,
          total: result.issues.length,
          hasNextPage: result.hasNextPage,
          nextPage: result.nextPage,
          issues: result.issues.map((i) => ({
            number: i.number,
            title: i.title,
            state: i.state,
            labels: i.labels,
            url: i.url,
            createdAt: i.createdAt,
            updatedAt: i.updatedAt,
          })),
        }, null, 2))
      },
    }
  }

  private getRemoteIssueConfig(): ToolConfig {
    return {
      name: 'get_remote_issue',
      description:
        'Get full details of a remote issue by its number (e.g. #42). ' +
        'Returns the issue body, labels, state, and recent comments. ' +
        'Use this to read the full context of a GitHub/GitLab issue.',
      schema: {
        providerId: z.string().describe('The issue provider ID'),
        number: z.number().int().describe('The remote issue number (e.g. 42 for #42)'),
      },
      execute: async (args) => {
        const resolved = await this.resolveRemoteAdapter(args.providerId as string)
        if (!resolved) {
          return this.errorResult(new Error('Provider not found or token unavailable'))
        }

        const [issue, commentsPage] = await Promise.all([
          resolved.adapter.getIssue(args.number as number),
          resolved.adapter.listComments(args.number as number, { perPage: 20 }),
        ])

        return this.textResult(JSON.stringify({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          labels: issue.labels,
          url: issue.url,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          comments: commentsPage.comments.map((c) => ({
            id: c.id,
            author: c.authorLogin,
            body: c.body,
            createdAt: c.createdAt,
          })),
        }, null, 2))
      },
    }
  }

  private commentRemoteIssueConfig(): ToolConfig {
    return {
      name: 'comment_remote_issue',
      description:
        'Post a comment on a remote GitHub/GitLab issue. ' +
        'The comment is posted immediately to the remote platform. ' +
        'IMPORTANT: Only call this when the user explicitly asks to comment on an issue.',
      schema: {
        providerId: z.string().describe('The issue provider ID'),
        number: z.number().int().describe('The remote issue number'),
        body: z.string().describe('Comment body in Markdown format'),
      },
      execute: async (args) => {
        const resolved = await this.resolveRemoteAdapter(args.providerId as string)
        if (!resolved) {
          return this.errorResult(new Error('Provider not found or token unavailable'))
        }

        const comment = await resolved.adapter.createComment(
          args.number as number,
          normaliseLlmText(args.body as string),
        )

        return this.textResult(JSON.stringify({
          success: true,
          commentId: comment.id,
          createdAt: comment.createdAt,
        }, null, 2))
      },
    }
  }

  // ── Serialisation helpers ───────────────────────────────────────────────────

  /**
   * Brief summary representation for list_issues and children in get_issue.
   * Omits description, images and sessionId to keep list responses compact.
   * Timestamps are ISO 8601 strings for human/LLM readability.
   */
  private toSummary(issue: Issue): Record<string, unknown> {
    return {
      id:        issue.id,
      title:     issue.title,
      status:    issue.status,
      priority:  issue.priority,
      labels:    issue.labels,
      projectId: issue.projectId,
      parentIssueId: issue.parentIssueId,
      createdAt: new Date(issue.createdAt).toISOString(),
      updatedAt: new Date(issue.updatedAt).toISOString(),
    }
  }

  /**
   * Full detail representation for get/create/update responses.
   * Includes description and sessionId but deliberately omits IssueImage.data
   * (base64 binary) to prevent flooding Claude's context window.
   * Empty description is normalised to null — distinguishes "not set" from "set to empty".
   * Timestamps are ISO 8601 strings.
   */
  private toDetail(issue: Issue): Record<string, unknown> {
    return {
      id:            issue.id,
      title:         issue.title,
      description:   issue.description || null,  // "" → null
      status:        issue.status,
      priority:      issue.priority,
      labels:        issue.labels,
      projectId:     issue.projectId,
      parentIssueId: issue.parentIssueId,
      sessionId:     issue.sessionId,             // exposed: enables hasSession reasoning
      imageCount:    issue.images.length,          // count only — no base64 payloads
      createdAt:     new Date(issue.createdAt).toISOString(),
      updatedAt:     new Date(issue.updatedAt).toISOString(),
    }
  }
}
