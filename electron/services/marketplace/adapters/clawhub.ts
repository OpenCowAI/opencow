// SPDX-License-Identifier: Apache-2.0

/**
 * ClawHub.ai (OpenClaw) Marketplace Adapter.
 *
 * ClawHub is open-source (MIT): https://github.com/openclaw/clawhub
 * Backend runs on Convex with OpenAI vector embeddings for semantic search.
 *
 * Strategy:
 *   Search  → GET /api/v1/search?q=...  (semantic vector search + lexical fallback)
 *   Browse  → GET /api/v1/skills         (paginated listing, sorted by updatedAt)
 *   Detail  → GET /api/v1/skills/{slug}
 *   Download→ GET /api/v1/download?slug=...  (ZIP)
 *             Fallback: reconstruct from detail API content
 *
 * IMPORTANT: `/api/v1/skills` is for BROWSING only — its `q` param is ignored.
 * Search MUST use the dedicated `/api/v1/search` endpoint.
 *
 * Authentication is optional for read-only operations.
 */

import { execFile } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import type {
  MarketplaceId,
  MarketSearchParams,
  MarketSearchResult,
  MarketBrowseParams,
  MarketSkillDetail,
  MarketSkillSummary,
} from '../../../../src/shared/types'
import type { MarketplaceSearchResponse, MarketplaceSettings } from '../types'
import { fetchWithTimeout, RATE_LIMITED_RESPONSE, searchErrorResponse } from '../utils/http'
import { parseFrontmatter } from '../utils/frontmatter'
import { BaseMarketplaceAdapter } from './base'

const execFileAsync = promisify(execFile)

/** Base API URL for ClawHub registry. */
const CLAWHUB_API = 'https://clawhub.ai/api/v1'

/**
 * Number of skills to fetch from the browse endpoint for search enrichment.
 * The search endpoint (/api/v1/search) returns lightweight results (no stats,
 * no author). By caching the top browse results, we can enrich search hits
 * with installs, author, tags etc. — matching ClawHub website richness.
 */
const ENRICHMENT_POOL_SIZE = 200

/** Browse cache TTL — 5 minutes. Browse data changes slowly. */
const BROWSE_CACHE_TTL_MS = 5 * 60 * 1_000

/** Shape of the ClawHub skills list API response (browse endpoint). */
interface ClawHubListResponse {
  items?: ClawHubSkillItem[]
  nextCursor?: string
}

/** Shape of the ClawHub search API response (search endpoint). */
interface ClawHubSearchResponse {
  results?: ClawHubSearchHit[]
}

/** A single hit from the /api/v1/search endpoint. */
interface ClawHubSearchHit {
  score?: number
  slug?: string
  displayName?: string
  summary?: string
  version?: string | null
  updatedAt?: number
}

/**
 * Shape of the ClawHub detail API response.
 *
 * IMPORTANT: The response is a NESTED structure — skill data lives inside
 * a `skill` key, NOT at the top level:
 *   { skill: { slug, displayName, ... }, latestVersion: {...}, owner: {...} }
 *
 * Source: https://github.com/openclaw/clawhub
 */
interface ClawHubDetailResponse {
  skill?: {
    slug?: string
    displayName?: string
    summary?: string
    tags?: Record<string, string>
    stats?: {
      comments?: number
      downloads?: number
      installsAllTime?: number
      installsCurrent?: number
      stars?: number
      versions?: number
    }
    createdAt?: number
    updatedAt?: number
  }
  latestVersion?: {
    version?: string
    createdAt?: number
    changelog?: string
    license?: string | null
  }
  metadata?: unknown
  owner?: {
    handle?: string
    userId?: string
    displayName?: string
    image?: string
  }
}

/**
 * Shape of an individual skill item from the browse listing endpoint.
 * Used by GET /api/v1/skills (list).
 */
interface ClawHubSkillItem {
  slug?: string
  displayName?: string
  name?: string
  summary?: string
  description?: string
  ownerUserId?: string
  author?: string
  tags?: Record<string, string>
  stats?: {
    comments?: number
    downloads?: number
    installsAllTime?: number
    installsCurrent?: number
    stars?: number
    versions?: number
  }
  latestVersion?: {
    version?: string
    createdAt?: number
    changelog?: string
    license?: string | null
  }
  createdAt?: number
  updatedAt?: number
}

export class ClawHubAdapter extends BaseMarketplaceAdapter {
  readonly id: MarketplaceId = 'clawhub'
  readonly displayName = 'ClawHub'
  readonly icon = 'paw-print' // Lucide icon name
  readonly url = 'https://clawhub.ai'

  private token?: string
  private baseUrl = CLAWHUB_API

  /** Cached browse results for enriching search hits (slug → full summary). */
  private browseCache: Map<string, MarketSkillSummary> | null = null
  private browseCacheTime = 0

  override configure(settings: MarketplaceSettings): void {
    if (this.token !== settings.clawhubToken) {
      this.browseCache = null // Invalidate — different token may yield different data
    }
    this.token = settings.clawhubToken
  }

  // ─── Search ────────────────────────────────────────────────

  /**
   * Semantic search via ClawHub's dedicated search endpoint.
   *
   * Uses `/api/v1/search?q=...` which is powered by OpenAI vector embeddings
   * (text-embedding-3-small) + Convex vector search + lexical fallback.
   * Results are ranked by a hybrid score: semantic similarity + exact match
   * boosts + popularity weighting.
   *
   * Search results are **enriched** with stats/author from a cached browse
   * response (slug-matched). This mirrors the ClawHub website which shows
   * installs, stars, author for each search result.
   *
   * For empty queries, falls back to `/api/v1/skills` (browse listing).
   */
  async search(params: MarketSearchParams): Promise<MarketplaceSearchResponse> {
    try {
      const limit = params.limit ?? 30

      let items: MarketSkillSummary[]
      if (params.query?.trim()) {
        // Phase 1: parallel — semantic search + browse-cache warm-up
        const [searchHits, enrichMap] = await Promise.all([
          this.fetchSearchResults(params.query.trim(), limit),
          this.getEnrichmentMap(),
        ])
        items = enrichSearchHits(searchHits, enrichMap)

        // Phase 2: targeted detail enrichment for uncached hits
        // The browse cache only holds top-N popular skills. Semantic search
        // can return long-tail results outside that pool. For those, we
        // fetch individual detail endpoints to get author/stats.
        items = await this.enrichUncachedHits(items, enrichMap)
      } else {
        items = await this.fetchBrowseResults(limit)
      }

      return {
        status: { state: 'ok' },
        results: {
          items,
          total: items.length,
          hasMore: false,
        },
      }
    } catch (err) {
      if (err instanceof RateLimitError) return RATE_LIMITED_RESPONSE
      return searchErrorResponse(err)
    }
  }

  /**
   * Fetch results from the semantic search endpoint.
   * GET /api/v1/search?q=...&limit=...
   */
  private async fetchSearchResults(query: string, limit: number): Promise<MarketSkillSummary[]> {
    const url = new URL(`${this.baseUrl}/search`)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(limit))

    const resp = await fetchWithTimeout(url.toString(), {
      headers: this.requestHeaders(),
      redirect: 'follow',
    })

    if (!resp.ok) {
      if (resp.status === 429) throw new RateLimitError()
      const body = await resp.text().catch(() => '')
      throw new Error(`ClawHub search failed: ${resp.status} ${body.slice(0, 200)}`)
    }

    const data = (await resp.json()) as ClawHubSearchResponse
    return (data.results ?? []).map((hit) => this.transformSearchHit(hit))
  }

  /**
   * Fetch results from the browse listing endpoint.
   * GET /api/v1/skills?limit=...
   */
  private async fetchBrowseResults(limit: number): Promise<MarketSkillSummary[]> {
    const url = new URL(`${this.baseUrl}/skills`)
    url.searchParams.set('limit', String(limit))

    const resp = await fetchWithTimeout(url.toString(), {
      headers: this.requestHeaders(),
      redirect: 'follow',
    })

    if (!resp.ok) {
      if (resp.status === 429) throw new RateLimitError()
      const body = await resp.text().catch(() => '')
      throw new Error(`ClawHub browse failed: ${resp.status} ${body.slice(0, 200)}`)
    }

    const data = (await resp.json()) as ClawHubListResponse
    return (data.items ?? []).map((s) => this.transformSkill(s))
  }

  async browse(params: MarketBrowseParams): Promise<MarketSearchResult> {
    const resp = await this.search({ query: '', limit: params.limit, offset: params.offset })
    return resp.results
  }

  // ─── Detail ────────────────────────────────────────────────

  /**
   * Fetch and assemble a full skill detail.
   *
   * Two data sources are fetched **in parallel**:
   *   1. Detail metadata (GET /api/v1/skills/{slug}) — name, stats, owner, changelog
   *   2. SKILL.md content (GET /api/v1/download → ZIP → extract SKILL.md)
   *
   * The REST API does NOT return SKILL.md directly — it's only available
   * through the download ZIP. The ZIP is tiny (~2-3 KB), so the parallel
   * fetch adds minimal latency while providing the same rich content as
   * the ClawHub website.
   *
   * Fallback: if ZIP download fails, `changelog` is used as content.
   */
  async getDetail(slug: string): Promise<MarketSkillDetail> {
    // Phase 1: parallel fetch — metadata + SKILL.md content
    const [detail, skillMdRaw] = await Promise.all([
      this.fetchDetailWithRetry(slug),
      this.fetchSkillMdFromZip(slug),
    ])

    const skill = detail.skill
    const version = detail.latestVersion
    const owner = detail.owner
    const stats = skill?.stats
    const rawTags = skill?.tags ? Object.keys(skill.tags).filter((k) => k !== 'latest') : []
    const tags = rawTags.length > 0 ? rawTags : undefined

    // Phase 2: parse SKILL.md frontmatter if available
    const parsed = skillMdRaw ? parseFrontmatter(skillMdRaw) : null

    // Content priority: SKILL.md body > changelog > summary
    const content = parsed?.body || version?.changelog || skill?.summary || ''

    return {
      slug: skill?.slug ?? slug,
      name: skill?.displayName ?? parsed?.name ?? slug,
      description: skill?.summary ?? parsed?.description ?? '',
      author: owner?.handle ?? owner?.displayName ?? '',
      content,
      attributes: parsed?.attributes ?? {},
      tags,
      version: version?.version,
      license: version?.license ?? (parsed?.attributes['license'] as string | undefined),
      installs: stats?.installsAllTime ?? stats?.downloads,
      stars: stats?.stars,
      versionCount: stats?.versions,
      marketplaceId: 'clawhub',
    }
  }

  /**
   * Fetch detail with exponential back-off retry on 429.
   *
   * ClawHub's Convex backend enforces strict rate limits. Since we may
   * have just called /search or /skills moments ago, the detail request
   * can land within the same rate window. Retrying with a short delay
   * avoids surfacing a transient 429 to the user.
   */
  private async fetchDetailWithRetry(
    slug: string,
    maxRetries = 2,
  ): Promise<ClawHubDetailResponse> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, attempt * 1_000))
      }

      const resp = await fetchWithTimeout(
        `${this.baseUrl}/skills/${encodeURIComponent(slug)}`,
        { headers: this.requestHeaders(), redirect: 'follow' },
      )

      if (resp.ok) {
        return (await resp.json()) as ClawHubDetailResponse
      }

      if (resp.status === 429 && attempt < maxRetries) {
        const retryAfter = resp.headers.get('Retry-After')
        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10)
          if (!isNaN(seconds) && seconds > 0 && seconds <= 10) {
            await new Promise((r) => setTimeout(r, seconds * 1_000))
          }
        }
        lastError = new Error(`ClawHub rate limited (attempt ${attempt + 1})`)
        continue
      }

      throw new Error(`ClawHub detail failed: ${resp.status}`)
    }

    throw lastError ?? new Error('ClawHub detail failed after retries')
  }

  /**
   * Extract SKILL.md content from the download ZIP.
   *
   * ClawHub ZIPs are tiny (~2-3 KB) with files at the root level:
   *   SKILL.md, README.md, package.json, _meta.json
   *
   * Uses `unzip -p` to pipe SKILL.md to stdout — no temp extraction needed.
   * Returns empty string on any failure (best-effort, never throws).
   */
  private async fetchSkillMdFromZip(slug: string): Promise<string> {
    try {
      const zipUrl = `${this.baseUrl}/download?slug=${encodeURIComponent(slug)}`
      const resp = await fetchWithTimeout(zipUrl, {
        headers: this.requestHeaders(),
        redirect: 'follow',
      }, 15_000)

      if (!resp.ok) return ''

      const buffer = Buffer.from(await resp.arrayBuffer())
      const tmpZip = path.join(os.tmpdir(), `clawhub-${crypto.randomUUID()}.zip`)

      try {
        await fs.writeFile(tmpZip, buffer)
        // `unzip -p` prints file content to stdout — no temp directory needed
        // NOTE: `unzip` is available on macOS/Linux. If Windows support is needed
        // in the future, replace with a pure-JS ZIP library (e.g. adm-zip).
        const { stdout } = await execFileAsync('unzip', ['-p', tmpZip, 'SKILL.md'])
        return stdout
      } finally {
        await fs.rm(tmpZip, { force: true }).catch(() => {})
      }
    } catch {
      return '' // Best-effort — caller falls back to changelog
    }
  }

  // ─── Download ──────────────────────────────────────────────

  async download(slug: string, targetDir: string): Promise<void> {
    // Strategy 1: ZIP download from the download API
    const zipExtracted = await this.tryZipDownload(slug, targetDir)
    if (zipExtracted) return

    // Strategy 2: Reconstruct a minimal SKILL.md from detail API metadata.
    // The REST API doesn't return the full SKILL.md content — only summary
    // and changelog are available. This fallback produces a usable file.
    const detail = await this.fetchDetailWithRetry(slug)
    const name = detail.skill?.displayName ?? slug
    const summary = detail.skill?.summary ?? ''
    const changelog = detail.latestVersion?.changelog ?? ''
    const content = [`# ${name}`, '', summary, '', changelog].filter(Boolean).join('\n')
    await fs.writeFile(path.join(targetDir, 'SKILL.md'), content, 'utf-8')
  }

  /**
   * Attempt to download and extract a ZIP bundle.
   * Returns `true` if the bundle was successfully extracted, `false` otherwise.
   * Never throws — failures are expected and trigger the detail API fallback.
   */
  private async tryZipDownload(slug: string, targetDir: string): Promise<boolean> {
    try {
      const zipUrl = `${this.baseUrl}/download?slug=${encodeURIComponent(slug)}`
      const zipResp = await fetchWithTimeout(zipUrl, {
        headers: this.requestHeaders(),
        redirect: 'follow',
      }, 30_000)

      if (!zipResp.ok || !zipResp.headers.get('content-type')?.includes('zip')) {
        return false
      }

      const buffer = Buffer.from(await zipResp.arrayBuffer())
      await this.extractZip(buffer, targetDir)
      return true
    } catch {
      return false
    }
  }

  // ─── Availability ──────────────────────────────────────────

  async checkAvailability(): Promise<boolean> {
    try {
      const resp = await fetchWithTimeout(
        `${this.baseUrl}/skills?limit=1`,
        { headers: this.requestHeaders(), redirect: 'follow' },
        5_000,
      )
      return resp.ok
    } catch {
      return false
    }
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * Get or refresh the browse-data enrichment cache.
   *
   * The search endpoint returns lightweight hits (no stats, no author).
   * The browse endpoint returns full skill objects. By caching browse
   * results (keyed by slug), we can enrich search hits cheaply.
   *
   * - First search: fetches browse data in parallel (1 extra API call)
   * - Subsequent searches within 5 min: zero extra API calls (cache hit)
   * - Best-effort: if browse fails, returns empty map (search still works)
   */
  private async getEnrichmentMap(): Promise<Map<string, MarketSkillSummary>> {
    const now = Date.now()
    if (this.browseCache && now - this.browseCacheTime < BROWSE_CACHE_TTL_MS) {
      return this.browseCache
    }

    try {
      const items = await this.fetchBrowseResults(ENRICHMENT_POOL_SIZE)
      this.browseCache = new Map(items.map((item) => [item.slug, item]))
      this.browseCacheTime = now
    } catch {
      // Best-effort — return stale cache or empty map
      if (!this.browseCache) this.browseCache = new Map()
    }

    return this.browseCache
  }

  /**
   * Enrich search hits that weren't found in the browse cache.
   *
   * For each uncached slug, fetch `/api/v1/skills/{slug}` to retrieve
   * author, installs, stars, versionCount. Requests run in parallel
   * batches (DETAIL_CONCURRENCY). If a batch encounters a 429, remaining
   * batches are skipped — the search result is still usable, just less rich.
   */
  private async enrichUncachedHits(
    items: MarketSkillSummary[],
    cachedSlugs: Map<string, MarketSkillSummary>,
  ): Promise<MarketSkillSummary[]> {
    const uncachedSlugs = items
      .filter((item) => item.slug && !cachedSlugs.has(item.slug))
      .map((item) => item.slug)

    if (uncachedSlugs.length === 0) return items

    const DETAIL_CONCURRENCY = 5
    const detailMap = new Map<
      string,
      { author: string; installs?: number; stars?: number; versionCount?: number }
    >()

    outer: for (let i = 0; i < uncachedSlugs.length; i += DETAIL_CONCURRENCY) {
      const batch = uncachedSlugs.slice(i, i + DETAIL_CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map((slug) => this.fetchQuickDetail(slug)),
      )

      for (let j = 0; j < batch.length; j++) {
        const result = results[j]
        if (result.status === 'fulfilled' && result.value) {
          const { skill, owner } = result.value
          const stats = skill?.stats
          detailMap.set(batch[j], {
            author: owner?.handle ?? owner?.displayName ?? '',
            installs: stats?.installsAllTime ?? stats?.downloads,
            stars: stats?.stars,
            versionCount: stats?.versions,
          })
        } else if (
          result.status === 'rejected' &&
          result.reason instanceof RateLimitError
        ) {
          break outer // Stop all batches — rate limited
        }
      }
    }

    if (detailMap.size === 0) return items

    return items.map((item) => {
      const d = detailMap.get(item.slug)
      if (!d) return item
      return {
        ...item,
        author: d.author || item.author,
        installs: d.installs ?? item.installs,
        stars: d.stars ?? item.stars,
        versionCount: d.versionCount ?? item.versionCount,
      }
    })
  }

  /**
   * Single-attempt detail fetch — returns null on non-429 errors.
   * Throws RateLimitError on 429 to signal the batch to stop.
   */
  private async fetchQuickDetail(slug: string): Promise<ClawHubDetailResponse | null> {
    try {
      const resp = await fetchWithTimeout(
        `${this.baseUrl}/skills/${encodeURIComponent(slug)}`,
        { headers: this.requestHeaders(), redirect: 'follow' },
        5_000, // Keep it snappy — 5s timeout
      )

      if (resp.status === 429) throw new RateLimitError()
      if (!resp.ok) return null
      return (await resp.json()) as ClawHubDetailResponse
    } catch (err) {
      if (err instanceof RateLimitError) throw err
      return null // Network error, timeout, etc. — skip silently
    }
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`
    return headers
  }

  /** Transform a browse listing item (full skill object) into summary. */
  private transformSkill(item: ClawHubSkillItem): MarketSkillSummary {
    const stats = item.stats
    const rawTags = item.tags ? Object.keys(item.tags).filter((k) => k !== 'latest') : []
    const tags = rawTags.length > 0 ? rawTags : undefined

    return {
      slug: item.slug ?? '',
      name: item.displayName ?? item.name ?? item.slug ?? '',
      description: item.summary ?? item.description ?? '',
      author: item.author ?? item.ownerUserId ?? '',
      installs: stats?.installsAllTime ?? stats?.downloads,
      stars: stats?.stars,
      versionCount: stats?.versions,
      version: item.latestVersion?.version,
      updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined,
      tags,
      marketplaceId: 'clawhub',
    }
  }

  /** Transform a search hit (lightweight, score-ranked) into summary. */
  private transformSearchHit(hit: ClawHubSearchHit): MarketSkillSummary {
    return {
      slug: hit.slug ?? '',
      name: hit.displayName ?? hit.slug ?? '',
      description: hit.summary ?? '',
      author: '', // Search endpoint doesn't return author — filled on detail view
      version: hit.version ?? undefined,
      updatedAt: hit.updatedAt ? new Date(hit.updatedAt).toISOString() : undefined,
      marketplaceId: 'clawhub',
    }
  }

  /** Extract a ZIP buffer to a target directory. Throws on failure. */
  private async extractZip(buffer: Buffer, targetDir: string): Promise<void> {
    const zipPath = path.join(targetDir, '__download__.zip')
    await fs.writeFile(zipPath, buffer)

    try {
      await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', targetDir])
    } finally {
      await fs.rm(zipPath, { force: true }).catch(() => {})
    }
  }
}

// ─── Module-level helpers ─────────────────────────────────────

/**
 * Enrich lightweight search hits with stats/author from browse data.
 *
 * The search endpoint returns: slug, displayName, summary, score, updatedAt.
 * The browse endpoint returns: + author, installs, stars, tags, version.
 *
 * For skills found in the browse cache, we merge the richer data.
 * For uncached skills (long-tail), the search hit is returned as-is.
 */
function enrichSearchHits(
  hits: MarketSkillSummary[],
  browseMap: Map<string, MarketSkillSummary>,
): MarketSkillSummary[] {
  if (browseMap.size === 0) return hits

  return hits.map((hit) => {
    const data = browseMap.get(hit.slug)
    if (!data) return hit
    return {
      ...hit,
      author: data.author || hit.author,
      installs: data.installs ?? hit.installs,
      stars: data.stars ?? hit.stars,
      versionCount: data.versionCount ?? hit.versionCount,
      tags: data.tags ?? hit.tags,
      version: data.version ?? hit.version,
    }
  })
}

/** Sentinel error to distinguish 429 from other failures in search(). */
class RateLimitError extends Error {
  constructor() {
    super('Rate limited')
    this.name = 'RateLimitError'
  }
}
