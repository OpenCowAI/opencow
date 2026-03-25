// SPDX-License-Identifier: Apache-2.0

/**
 * UserRepoProvider — dynamic MarketplaceProvider for user-registered repos.
 *
 * Each registered repo source creates one UserRepoProvider instance that
 * seamlessly integrates into the existing MarketplaceService ecosystem.
 * Supports both GitHub and GitLab through the GitPlatform abstraction.
 *
 * Architecture:
 *   UserRepoProvider → GitPlatform → platform-specific API calls
 *   MarketplaceService.install() → UserRepoProvider.download() → capability discovery
 */

import type {
  MarketplaceId,
  MarketSearchParams,
  MarketSearchResult,
  MarketBrowseParams,
  MarketSkillDetail,
  MarketSkillSummary,
  MarketInstallPreview,
  RepoSourcePlatform,
} from '../../../../src/shared/types'
import type { MarketplaceSearchResponse, MarketplaceSettings } from '../types'
import type { GitPlatform, GitPlatformConfig } from '../platforms/types'
import { BaseMarketplaceAdapter } from '../adapters/base'
import { parseFrontmatter } from '../utils/frontmatter'
import { searchErrorResponse } from '../utils/http'
import type { ParsedRepoUrl } from '../utils/urlParser'

// ─── Types ──────────────────────────────────────────────────

export interface UserRepoProviderParams {
  sourceId: string
  name: string
  url: string
  platform: GitPlatform
  parsedUrl: ParsedRepoUrl
  branch?: string
  token?: string
}

// ─── Provider ───────────────────────────────────────────────

export class UserRepoProvider extends BaseMarketplaceAdapter {
  readonly id: MarketplaceId
  readonly displayName: string
  readonly icon: string
  readonly url: string

  readonly sourceId: string
  private readonly platform: GitPlatform
  private readonly parsedUrl: ParsedRepoUrl
  private readonly branch?: string
  private token?: string

  /** Cache of last probe result to avoid re-probing on every search. */
  private probeCache: { result: MarketInstallPreview; expiresAt: number } | null = null
  private static readonly PROBE_TTL_MS = 5 * 60_000 // 5 minutes

  constructor(params: UserRepoProviderParams) {
    super()
    this.sourceId = params.sourceId
    this.id = `user-repo:${params.sourceId}` as MarketplaceId
    this.displayName = params.name
    this.icon = params.parsedUrl.platform
    this.url = params.url
    this.platform = params.platform
    this.parsedUrl = params.parsedUrl
    this.branch = params.branch
    this.token = params.token
  }

  /** Update the auth token (e.g. when user changes credentials). */
  updateToken(token?: string): void {
    this.token = token
    this.probeCache = null
  }

  // ─── Private: build config ────────────────────────────────

  private buildConfig(): GitPlatformConfig {
    return {
      owner: this.parsedUrl.owner,
      repo: this.parsedUrl.repo,
      apiBase: this.parsedUrl.apiBase,
      branch: this.branch,
      headers: this.platform.buildAuthHeaders(this.token),
    }
  }

  // ─── MarketplaceProvider implementation ───────────────────

  override configure(_settings: MarketplaceSettings): void {
    // User repo providers manage their own tokens via updateToken()
  }

  async search(params: MarketSearchParams): Promise<MarketplaceSearchResponse> {
    try {
      const preview = await this.getProbeResult()
      const query = (params.query ?? '').toLowerCase()

      // Filter capabilities by query
      const filtered = query
        ? preview.capabilities.filter(
            (c) => c.name.toLowerCase().includes(query) || c.category.includes(query),
          )
        : preview.capabilities

      const items: MarketSkillSummary[] = filtered.map((cap) => ({
        slug: `${cap.category}/${cap.name}`,
        name: cap.name,
        description: `${cap.category} from ${this.displayName}`,
        author: this.parsedUrl.owner,
        repoUrl: this.url,
        marketplaceId: this.id,
        tags: [cap.category],
      }))

      return {
        status: { state: 'ok' },
        results: {
          items,
          total: items.length,
          hasMore: false,
        },
      }
    } catch (err) {
      return searchErrorResponse(err)
    }
  }

  async browse(params: MarketBrowseParams): Promise<MarketSearchResult> {
    const resp = await this.search({ query: '', limit: params.limit, offset: params.offset })
    return resp.results
  }

  async getDetail(slug: string): Promise<MarketSkillDetail> {
    const config = this.buildConfig()

    // slug format: "category/name" (e.g. "skill/brainstorming")
    const slashIdx = slug.indexOf('/')
    const name = slashIdx >= 0 ? slug.slice(slashIdx + 1) : slug
    const category = slashIdx >= 0 ? slug.slice(0, slashIdx) : 'skill'

    // Try to fetch content from common paths
    const candidates =
      category === 'skill'
        ? [`skills/${name}/SKILL.md`, `skills/${name}/README.md`]
        : [`${category}s/${name}.md`]

    let content = ''
    for (const candidate of candidates) {
      content = await this.platform.fetchFileContent({ ...config, path: candidate })
      if (content) break
    }

    // Fallback to repo README
    if (!content) {
      content = await this.platform.fetchFileContent({ ...config, path: 'README.md' })
    }

    const parsed = parseFrontmatter(content || `# ${name}\n\nNo description available.`)
    const meta = await this.platform.fetchRepoMeta(config)

    return {
      slug,
      name: parsed.name || name,
      description: parsed.description || meta?.description || '',
      author: this.parsedUrl.owner,
      content: parsed.body,
      attributes: parsed.attributes,
      files: [],
      repoUrl: this.url,
      marketplaceId: this.id,
      stars: meta?.stars ?? 0,
      tags: meta?.topics,
    }
  }

  async download(_slug: string, targetDir: string): Promise<void> {
    const config = this.buildConfig()
    // Download the entire repo — install() will handle capability discovery
    await this.platform.downloadRepo({ ...config, targetDir })
  }

  override async checkAvailability(): Promise<boolean> {
    const result = await this.testConnection()
    return result.ok
  }

  /** Test connectivity with error details — richer than checkAvailability(). */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const config = this.buildConfig()
    return this.platform.testConnection(config)
  }

  /** Fetch the HEAD commit SHA for the configured branch (used by sync). */
  async fetchHeadCommit(): Promise<string | null> {
    const config = this.buildConfig()
    return this.platform.fetchHeadCommit(config)
  }

  // ─── Probe (used by search + external callers) ────────────

  /**
   * MarketplaceProvider capability declaration.
   * Delegates to the cached probe via GitPlatform abstraction,
   * supporting both GitHub and GitLab without hardcoded platform checks.
   */
  async probeCapabilities(_slug: string): Promise<MarketInstallPreview> {
    return this.getProbeResult()
  }

  async getProbeResult(): Promise<MarketInstallPreview> {
    if (this.probeCache && Date.now() < this.probeCache.expiresAt) {
      return this.probeCache.result
    }

    const config = this.buildConfig()
    const result = await this.platform.probeCapabilities(config)
    this.probeCache = {
      result,
      expiresAt: Date.now() + UserRepoProvider.PROBE_TTL_MS,
    }
    return result
  }
}
