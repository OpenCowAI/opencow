// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub Repository Search Marketplace Adapter.
 *
 * Strategy:
 *   Search  → GitHub Search Repositories API  GET /search/repositories?q=...
 *   Detail  → GitHub Contents API (SKILL.md → README.md → repo description fallback)
 *   Download→ GitHub tarball API → extract → copy skill bundle
 *
 * Rate limits:
 *   - Unauthenticated: 10 req/min for search, 60 req/hr for REST
 *   - Authenticated (githubToken): 30 req/min for search, 5000 req/hr for REST
 *
 * 403/429 responses are gracefully encoded as `rate-limited` status — never thrown.
 */

import type {
  MarketSearchParams,
  MarketSearchResult,
  MarketBrowseParams,
  MarketSkillDetail,
  MarketSkillSummary,
} from '../../../../src/shared/types'
import type { MarketplaceSearchResponse, MarketplaceSettings } from '../types'
import { fetchWithTimeout, RATE_LIMITED_RESPONSE, searchErrorResponse } from '../utils/http'
import { githubHeaders } from '../utils/github'
import { parseFrontmatter } from '../utils/frontmatter'
import { downloadGithubTarball } from '../utils/tarball'
import { fetchMarkdownContent, fetchRepoMeta, fetchBundleFiles } from '../utils/githubContent'
import { BaseMarketplaceAdapter } from './base'

// ─── GitHub API response types ────────────────────────────

interface GitHubSearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GitHubRepoItem[]
}

interface GitHubRepoItem {
  full_name: string
  name: string
  owner: { login: string; avatar_url?: string }
  description: string | null
  html_url: string
  stargazers_count: number
  language: string | null
  topics?: string[]
  license?: { spdx_id?: string } | null
  updated_at?: string
}

// ─── Adapter ──────────────────────────────────────────────

export class GitHubAdapter extends BaseMarketplaceAdapter {
  readonly id = 'github' as const
  readonly displayName = 'GitHub'
  readonly icon = 'github'
  readonly url = 'https://github.com'

  private githubToken?: string

  override configure(settings: MarketplaceSettings): void {
    this.githubToken = settings.githubToken
  }

  // ─── Search ────────────────────────────────────────────────

  async search(params: MarketSearchParams): Promise<MarketplaceSearchResponse> {
    try {
      const limit = params.limit ?? 15
      const url = new URL('https://api.github.com/search/repositories')
      url.searchParams.set('q', params.query)
      url.searchParams.set('sort', 'stars')
      url.searchParams.set('order', 'desc')
      url.searchParams.set('per_page', String(limit))

      const resp = await fetchWithTimeout(url.toString(), {
        headers: githubHeaders(this.githubToken),
      })

      if (!resp.ok) {
        // GitHub sends 403 (not just 429) when rate-limited
        if (resp.status === 403 || resp.status === 429) return RATE_LIMITED_RESPONSE
        throw new Error(`GitHub search failed: ${resp.status}`)
      }

      const data = (await resp.json()) as GitHubSearchResponse

      return {
        status: { state: 'ok' },
        results: {
          items: data.items.map((repo) => transformRepo(repo)),
          total: Math.min(data.total_count, 1000), // GitHub caps at 1000
          hasMore: data.total_count > limit,
        },
      }
    } catch (err) {
      return searchErrorResponse(err)
    }
  }

  async browse(params: MarketBrowseParams): Promise<MarketSearchResult> {
    const query = buildBrowseQuery(params.mode)
    const resp = await this.search({ query, limit: params.limit, offset: params.offset })
    return resp.results
  }

  // ─── Detail ────────────────────────────────────────────────

  async getDetail(slug: string): Promise<MarketSkillDetail> {
    const { owner, repo } = parseSlug(slug)
    const repoUrl = `https://github.com/${owner}/${repo}`
    const headers = githubHeaders(this.githubToken)

    // Run all three concerns in PARALLEL — content, metadata, and directory listing
    // are independent of each other. This cuts latency from ~4 sequential requests
    // down to ~1 round-trip (the slowest of the three).
    const [content, repoMeta, files] = await Promise.all([
      fetchMarkdownContent({ owner, repo, candidates: ['SKILL.md', 'README.md'], headers }),
      fetchRepoMeta({ owner, repo, headers }),
      fetchBundleFiles({ owner, repo, dirPath: '', headers }),
    ])

    // Merge: prefer fetched content, fall back to repo description, then hardcoded
    const finalContent = content
      || (repoMeta ? `# ${repoMeta.name ?? repo}\n\n${repoMeta.description}` : '')
      || `# ${repo}\n\nNo description available. View the source at [${repoUrl}](${repoUrl}).`

    const parsed = parseFrontmatter(finalContent)

    return {
      slug,
      name: parsed.name || repo,
      description: parsed.description || repoMeta?.description || '',
      author: owner,
      content: parsed.body,
      attributes: parsed.attributes,
      files,
      repoUrl,
      marketplaceId: 'github',
      license: repoMeta?.license ?? (parsed.attributes['license'] as string) ?? undefined,
      compatibility: (parsed.attributes['compatibility'] as string) ?? undefined,
      stars: repoMeta?.stars ?? 0,
      tags: repoMeta?.topics?.length ? repoMeta.topics : undefined,
    }
  }

  // ─── Download ──────────────────────────────────────────────

  async download(slug: string, targetDir: string): Promise<void> {
    const { owner, repo } = parseSlug(slug)
    await downloadGithubTarball({
      owner,
      repo,
      headers: githubHeaders(this.githubToken),
      targetDir,
    })
  }

  // ─── Availability ──────────────────────────────────────────

  async checkAvailability(): Promise<boolean> {
    try {
      const resp = await fetchWithTimeout(
        'https://api.github.com/rate_limit',
        { headers: githubHeaders(this.githubToken) },
        5_000,
      )
      return resp.ok
    } catch {
      return false
    }
  }
}

// ─── Module-level pure functions ─────────────────────────────

/**
 * Parse a GitHub slug into owner/repo coordinates.
 * Slug format: `{owner}/{repo}` (e.g. "vercel/ai-sdk")
 */
function parseSlug(slug: string): { owner: string; repo: string } {
  const parts = slug.split('/')
  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1] }
  }
  throw new Error(`Invalid GitHub slug: ${slug}`)
}

/** Build a GitHub search query for browse modes using dynamic relative dates. */
function buildBrowseQuery(mode: string): string {
  const now = new Date()
  const daysAgo = (days: number): string => {
    const d = new Date(now.getTime() - days * 86_400_000)
    return d.toISOString().slice(0, 10) // YYYY-MM-DD
  }

  switch (mode) {
    case 'trending': return `stars:>100 pushed:>${daysAgo(90)}`
    case 'popular':  return 'stars:>500'
    case 'recent':   return `created:>${daysAgo(180)}`
    case 'featured': return 'stars:>1000 topic:claude'
    default:         return 'stars:>100'
  }
}

function transformRepo(repo: GitHubRepoItem): MarketSkillSummary {
  return {
    slug: repo.full_name,
    name: repo.name,
    description: repo.description ?? '',
    author: repo.owner.login,
    stars: repo.stargazers_count,
    repoUrl: repo.html_url,
    marketplaceId: 'github',
    tags: repo.topics,
  }
}
