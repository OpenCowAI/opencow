// SPDX-License-Identifier: Apache-2.0

import { Octokit } from 'octokit'
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
 * GitHub adapter using the official Octokit SDK.
 *
 * Benefits over raw fetch():
 * - Built-in retry on 5xx / rate-limit (via plugin-retry + plugin-throttle)
 * - Automatic pagination helpers
 * - Full TypeScript types for all endpoints
 * - GitHub Enterprise support via `baseUrl`
 */
export class GitHubAdapter implements RemoteWriteAdapter {
  readonly label: string
  private readonly octokit: Octokit
  private readonly owner: string
  private readonly repo: string

  constructor(opts: {
    owner: string
    repo: string
    token: string
    /** Override for GitHub Enterprise. Defaults to 'https://api.github.com'. */
    apiBaseUrl?: string
  }) {
    this.owner = opts.owner
    this.repo = opts.repo
    this.label = `github:${opts.owner}/${opts.repo}`

    this.octokit = new Octokit({
      auth: opts.token,
      baseUrl: opts.apiBaseUrl?.replace(/\/+$/, '') || undefined,
      userAgent: 'OpenCow-Issue-Sync/1.0',
      retry: { enabled: true },
      throttle: {
        onRateLimit: (retryAfter: number, options: Record<string, unknown>, _octokit: unknown, retryCount: number) => {
          if (retryCount < 2) {
            console.warn(`[GitHubAdapter] Rate limit hit for ${String(options.url)}, retrying after ${retryAfter}s`)
            return true
          }
          return false
        },
        onSecondaryRateLimit: (retryAfter: number, options: Record<string, unknown>, _octokit: unknown, retryCount: number) => {
          if (retryCount < 1) {
            console.warn(`[GitHubAdapter] Secondary rate limit for ${String(options.url)}, retrying after ${retryAfter}s`)
            return true
          }
          return false
        },
      },
    })
  }

  async listIssues(opts?: ListRemoteIssuesOptions): Promise<RemoteIssuePage> {
    const page = opts?.page ?? 1
    const perPage = opts?.perPage ?? 100
    const state = opts?.state ?? 'all'

    const response = await this.octokit.rest.issues.listForRepo({
      owner: this.owner,
      repo: this.repo,
      state,
      page,
      per_page: perPage,
      sort: 'updated',
      direction: 'desc',
      ...(opts?.since ? { since: opts.since.toISOString() } : {}),
    })

    // GitHub's /issues endpoint also returns pull requests — filter them out.
    const issues: RemoteIssue[] = response.data
      .filter((item) => !item.pull_request)
      .map(mapGitHubIssue)

    // Octokit normalises Link header into response.headers.link
    const linkHeader = response.headers.link ?? ''
    const hasNextPage = linkHeader.includes('rel="next"')

    return {
      issues,
      hasNextPage,
      nextPage: hasNextPage ? page + 1 : undefined,
    }
  }

  async getIssue(number: number): Promise<RemoteIssue> {
    const response = await this.octokit.rest.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
    })
    return mapGitHubIssue(response.data)
  }

  async testConnection(): Promise<RemoteConnectionResult> {
    try {
      await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      })
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
    const response = await this.octokit.rest.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      labels: input.labels,
      assignees: input.assignees,
      ...(input.milestone != null ? { milestone: input.milestone } : {}),
    })
    return mapGitHubIssue(response.data)
  }

  async updateIssue(number: number, input: UpdateRemoteIssueInput): Promise<RemoteIssue> {
    const response = await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
      ...(input.assignees !== undefined ? { assignees: input.assignees } : {}),
      ...(input.milestone !== undefined ? { milestone: input.milestone ?? undefined } : {}),
    })
    return mapGitHubIssue(response.data)
  }

  async closeIssue(number: number): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      state: 'closed',
    })
  }

  async reopenIssue(number: number): Promise<void> {
    await this.octokit.rest.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      state: 'open',
    })
  }

  async createComment(issueNumber: number, body: string): Promise<RemoteComment> {
    const response = await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    })
    return mapGitHubComment(response.data)
  }

  async listComments(
    issueNumber: number,
    opts?: { page?: number; perPage?: number; since?: Date },
  ): Promise<RemoteCommentPage> {
    const page = opts?.page ?? 1
    const perPage = opts?.perPage ?? 100

    const response = await this.octokit.rest.issues.listComments({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      page,
      per_page: perPage,
      sort: 'created',
      direction: 'asc',
      ...(opts?.since ? { since: opts.since.toISOString() } : {}),
    })

    const comments: RemoteComment[] = response.data.map(mapGitHubComment)
    const linkHeader = response.headers.link ?? ''
    const hasNextPage = linkHeader.includes('rel="next"')

    return {
      comments,
      hasNextPage,
      nextPage: hasNextPage ? page + 1 : undefined,
    }
  }
}

// ─── Mapping ──────────────────────────────────────────────────────────────

interface GitHubIssueData {
  number: number
  title: string
  body?: string | null
  state?: string
  html_url: string
  labels: Array<{ name?: string } | string>
  created_at: string
  updated_at: string
  pull_request?: unknown
}

function mapGitHubIssue(item: GitHubIssueData): RemoteIssue {
  return {
    number: item.number,
    title: item.title,
    body: item.body ?? '',
    state: item.state ?? 'open',
    labels: item.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
    url: item.html_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}

interface GitHubCommentData {
  id: number
  body?: string | null
  user?: { login?: string; avatar_url?: string } | null
  created_at: string
  updated_at: string
}

function mapGitHubComment(item: GitHubCommentData): RemoteComment {
  return {
    id: String(item.id),
    body: item.body ?? '',
    authorLogin: item.user?.login ?? '',
    authorName: item.user?.login ?? '', // GitHub doesn't expose name in comment responses
    authorAvatar: item.user?.avatar_url ?? '',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }
}
