// SPDX-License-Identifier: Apache-2.0

import { Gitlab } from '@gitbeaker/rest'
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

/**
 * GitLab adapter using the Gitbeaker SDK (`@gitbeaker/rest`).
 *
 * Benefits over raw fetch():
 * - Typed API for all GitLab endpoints
 * - Built-in pagination support
 * - Self-hosted GitLab support via `host` option
 * - Automatic token header management
 */
export class GitLabAdapter implements RemoteWriteAdapter {
  readonly label: string
  private readonly gitlab: InstanceType<typeof Gitlab>
  private readonly projectPath: string

  constructor(opts: {
    owner: string
    repo: string
    token: string
    /** Override for self-hosted GitLab. Defaults to 'https://gitlab.com'. */
    apiBaseUrl?: string
  }) {
    this.projectPath = `${opts.owner}/${opts.repo}`
    this.label = `gitlab:${this.projectPath}`

    // Gitbeaker expects host without /api/v4 suffix
    let host = opts.apiBaseUrl?.replace(/\/+$/, '') ?? 'https://gitlab.com'
    // If user passes full API URL, strip the /api/v4 suffix
    host = host.replace(/\/api\/v[0-9]+$/, '')

    this.gitlab = new Gitlab({
      token: opts.token,
      host,
    })
  }

  async listIssues(opts?: ListRemoteIssuesOptions): Promise<RemoteIssuePage> {
    const page = opts?.page ?? 1
    const perPage = opts?.perPage ?? 100
    const state = opts?.state ?? 'all'

    const params: Record<string, unknown> = {
      state: mapStateParam(state),
      page,
      perPage,
      orderBy: 'updated_at',
      sort: 'desc',
    }

    if (opts?.since) {
      params.updatedAfter = opts.since.toISOString()
    }

    // Use showExpanded to get pagination metadata in response headers
    const response = await this.gitlab.Issues.all({
      projectId: this.projectPath,
      ...params,
      showExpanded: true,
    })

    // When showExpanded is true, response is { data, paginationInfo }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expanded = response as any
    const items = Array.isArray(expanded.data) ? expanded.data : (Array.isArray(response) ? response : [])
    const paginationInfo = expanded.paginationInfo

    const issues: RemoteIssue[] = items.map(mapGitLabIssue)

    // Determine pagination: prefer paginationInfo from Gitbeaker's showExpanded,
    // fall back to heuristic (but be conservative — only continue if we got a full page).
    let hasNextPage: boolean
    if (paginationInfo) {
      // Gitbeaker paginationInfo.next is the next page number, or null/0 if none
      hasNextPage = paginationInfo.next != null && paginationInfo.next !== 0
    } else {
      // Fallback heuristic: if we got fewer items than perPage, we're on the last page.
      // If we got exactly perPage, there MIGHT be more — accept the extra empty request
      // as the cost of correctness (avoids silently missing data).
      hasNextPage = issues.length >= perPage
    }

    return {
      issues,
      hasNextPage,
      nextPage: hasNextPage ? page + 1 : undefined,
    }
  }

  async getIssue(number: number): Promise<RemoteIssue> {
    const item = await this.gitlab.Issues.show(number, {
      projectId: this.projectPath,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mapGitLabIssue(item as any)
  }

  async testConnection(): Promise<RemoteConnectionResult> {
    try {
      await this.gitlab.Projects.show(this.projectPath)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ── Phase 2: Write operations ───────────────────────────────────────────

  async createIssue(input: CreateRemoteIssueInput): Promise<RemoteIssue> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = await this.gitlab.Issues.create(this.projectPath, {
      title: input.title,
      description: input.body,
      labels: input.labels?.join(','),
      assigneeIds: undefined, // GitLab uses numeric IDs — handled at service layer
      milestoneId: input.milestone ?? undefined,
    } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mapGitLabIssue(item as any)
  }

  async updateIssue(number: number, input: UpdateRemoteIssueInput): Promise<RemoteIssue> {
    const params: Record<string, unknown> = {}
    if (input.title !== undefined) params.title = input.title
    if (input.body !== undefined) params.description = input.body
    if (input.labels !== undefined) params.labels = input.labels.join(',')
    if (input.milestone !== undefined) params.milestoneId = input.milestone ?? 0 // 0 removes milestone in GitLab

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = await this.gitlab.Issues.edit(this.projectPath, number, params as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return mapGitLabIssue(item as any)
  }

  async closeIssue(number: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.gitlab.Issues.edit(this.projectPath, number, { stateEvent: 'close' } as any)
  }

  async reopenIssue(number: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.gitlab.Issues.edit(this.projectPath, number, { stateEvent: 'reopen' } as any)
  }

  async createComment(issueNumber: number, body: string): Promise<RemoteComment> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = await this.gitlab.IssueNotes.create(this.projectPath, issueNumber, body) as any
    return mapGitLabComment(item)
  }

  async listComments(
    issueNumber: number,
    opts?: { page?: number; perPage?: number; since?: Date },
  ): Promise<RemoteCommentPage> {
    const page = opts?.page ?? 1
    const perPage = opts?.perPage ?? 100

    const params: Record<string, unknown> = {
      page,
      perPage,
      sort: 'asc',
      orderBy: 'created_at',
      showExpanded: true,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await this.gitlab.IssueNotes.all(this.projectPath, issueNumber, params as any) as any
    const items = Array.isArray(response.data) ? response.data : (Array.isArray(response) ? response : [])
    const paginationInfo = response.paginationInfo

    // Filter out system notes (GitLab returns status-change notes alongside user comments)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comments: RemoteComment[] = items
      .filter((n: any) => !n.system)
      .map(mapGitLabComment)

    const hasNextPage = paginationInfo
      ? (paginationInfo.next != null && paginationInfo.next !== 0)
      : items.length >= perPage

    return {
      comments,
      hasNextPage,
      nextPage: hasNextPage ? page + 1 : undefined,
    }
  }
}

// ─── Mapping ──────────────────────────────────────────────────────────────

interface GitLabIssueData {
  iid: number
  title: string
  description?: string | null
  state: string // 'opened' | 'closed'
  web_url: string
  labels: string[]
  created_at: string
  updated_at: string
}

function mapGitLabIssue(item: GitLabIssueData): RemoteIssue {
  return {
    number: item.iid,
    title: item.title,
    body: item.description ?? '',
    state: item.state === 'opened' ? 'open' : item.state,
    labels: item.labels,
    url: item.web_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

interface GitLabCommentData {
  id: number
  body: string
  author?: { username?: string; name?: string; avatar_url?: string }
  created_at: string
  updated_at: string
  system?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapGitLabComment(item: any): RemoteComment {
  const data = item as GitLabCommentData
  return {
    id: String(data.id),
    body: data.body ?? '',
    authorLogin: data.author?.username ?? '',
    authorName: data.author?.name ?? data.author?.username ?? '',
    authorAvatar: data.author?.avatar_url ?? '',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

/** Map our unified state param to GitLab's expected values. */
function mapStateParam(state: 'open' | 'closed' | 'all'): string {
  if (state === 'open') return 'opened'
  if (state === 'closed') return 'closed'
  return 'all'
}
