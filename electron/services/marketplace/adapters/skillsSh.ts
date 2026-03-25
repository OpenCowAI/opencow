// SPDX-License-Identifier: Apache-2.0

/**
 * skills.sh Marketplace Adapter.
 *
 * Strategy:
 *   Search  → skills.sh public API  GET /api/search?q=...  (no auth required)
 *   Detail  → GitHub Contents API   (raw SKILL.md from the skill's source repo)
 *   Download→ GitHub tarball → extract → copy skill bundle
 *
 * Utility concerns (HTTP, GitHub, frontmatter) are composed via imports
 * from `../utils/` — NOT inherited from the base class.
 */

import * as path from 'node:path'

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
import {
  fetchMarkdownContent,
  fetchRepoMeta,
  fetchBundleFiles,
  resolveSkillRoot,
} from '../utils/githubContent'
import type { GitHubRepoCoordinates } from '../utils/githubContent'
import { BaseMarketplaceAdapter } from './base'

// ─── skills.sh API response types ──────────────────────────

/** A single skill item from skills.sh search API */
interface SkillsShSkill {
  /** Full ID: "{owner}/{repo}/{skillId}" (e.g. "github/awesome-copilot/git-commit") */
  id: string
  /** Short skill identifier (e.g. "git-commit") */
  skillId: string
  /** Display name */
  name: string
  /** Install count */
  installs?: number
  /** Source repo: "{owner}/{repo}" (e.g. "github/awesome-copilot") */
  source?: string
}

/** skills.sh search API response shape */
interface SkillsShSearchResponse {
  query: string
  searchType: string
  skills: SkillsShSkill[]
  count: number
  duration_ms?: number
}

/** Parsed GitHub coordinates from a skills.sh slug (extends shared base). */
interface SkillsShCoordinates extends GitHubRepoCoordinates {
  /** Sub-path within the repo where the skill lives (empty = repo root). */
  skillPath: string
}

// ─── Adapter ──────────────────────────────────────────────

export class SkillsShAdapter extends BaseMarketplaceAdapter {
  readonly id = 'skills.sh' as const
  readonly displayName = 'Skills.sh'
  readonly icon = 'globe'
  readonly url = 'https://skills.sh'

  private githubToken?: string

  override configure(settings: MarketplaceSettings): void {
    this.githubToken = settings.githubToken
  }

  // ─── Search ────────────────────────────────────────────────

  async search(params: MarketSearchParams): Promise<MarketplaceSearchResponse> {
    try {
      const url = new URL('https://skills.sh/api/search')
      url.searchParams.set('q', params.query)
      if (params.limit) url.searchParams.set('limit', String(params.limit))

      const resp = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      })

      if (!resp.ok) {
        if (resp.status === 429) return RATE_LIMITED_RESPONSE
        throw new Error(`skills.sh search failed: ${resp.status}`)
      }

      const data = (await resp.json()) as SkillsShSearchResponse
      const skills = data.skills ?? []
      const items = skills.map((s) => transformSkill(s))

      // Best-effort: enrich items with GitHub repo descriptions in parallel.
      // skills.sh API doesn't return descriptions, but all skills live on GitHub.
      await this.enrichDescriptions(items)

      return {
        status: { state: 'ok' },
        results: {
          items,
          total: data.count ?? skills.length,
          hasMore: false,
        },
      }
    } catch (err) {
      return searchErrorResponse(err)
    }
  }

  async browse(params: MarketBrowseParams): Promise<MarketSearchResult> {
    const modeQueries: Record<string, string> = {
      trending: 'trending',
      popular: 'popular',
      recent: 'new',
      featured: 'best',
    }
    const query = modeQueries[params.mode] ?? 'skills'
    const resp = await this.search({ query, limit: params.limit, offset: params.offset })
    return resp.results
  }

  // ─── Detail ────────────────────────────────────────────────

  async getDetail(slug: string): Promise<MarketSkillDetail> {
    const coords = parseSlug(slug)
    const repoUrl = `https://github.com/${coords.owner}/${coords.repo}`
    const headers = githubHeaders(this.githubToken)

    // Phase 1: Resolve the skill's actual path within the repo + fetch metadata.
    // resolveSkillRoot probes CDN (no rate limit) to determine if the skill
    // lives at skills/{id}/, {id}/, or repo root.
    const [skillRoot, repoMeta] = await Promise.all([
      resolveSkillRoot({ owner: coords.owner, repo: coords.repo, headers, skillPath: coords.skillPath }),
      fetchRepoMeta({ owner: coords.owner, repo: coords.repo, headers }),
    ])

    // Phase 2: With resolved root, fetch content + bundle files in parallel.
    const candidates = skillRoot
      ? [`${skillRoot}/SKILL.md`, `${skillRoot}/README.md`, 'SKILL.md', 'README.md']
      : ['SKILL.md', 'README.md']

    const [content, files] = await Promise.all([
      fetchMarkdownContent({ owner: coords.owner, repo: coords.repo, candidates, headers }),
      fetchBundleFiles({ owner: coords.owner, repo: coords.repo, dirPath: skillRoot, headers }),
    ])

    const finalContent = content
      || (repoMeta ? `# ${repoMeta.name ?? coords.repo}\n\n${repoMeta.description}` : '')
      || `# ${coords.repo}\n\nNo description available. View the source at [${repoUrl}](${repoUrl}).`

    const parsed = parseFrontmatter(finalContent)

    return {
      slug,
      name: parsed.name || path.basename(coords.skillPath || coords.repo),
      description: parsed.description || repoMeta?.description || '',
      author: coords.owner,
      content: parsed.body,
      attributes: parsed.attributes,
      files,
      repoUrl,
      marketplaceId: 'skills.sh',
      license: (parsed.attributes['license'] as string) ?? undefined,
      compatibility: (parsed.attributes['compatibility'] as string) ?? undefined,
    }
  }

  // ─── Download ──────────────────────────────────────────────

  async download(slug: string, targetDir: string): Promise<void> {
    const coords = parseSlug(slug)

    // skillPath is a hint for locating the skill within the repo.
    // The actual directory resolution happens locally after extraction
    // (scanning for SKILL.md) — no remote CDN probing needed here.
    await downloadGithubTarball({
      owner: coords.owner,
      repo: coords.repo,
      headers: githubHeaders(this.githubToken),
      targetDir,
      skillPath: coords.skillPath || undefined,
    })
  }

  // ─── Enrichment ──────────────────────────────────────────

  /**
   * Enrich search results with skill-specific descriptions (best-effort).
   *
   * Strategy: Fetch each skill's SKILL.md via raw.githubusercontent.com CDN
   * (using the shared fetchMarkdownContent in CDN-only mode), then extract
   * the `description` field from its YAML frontmatter.
   *
   * Why CDN-only?
   *   - Zero rate limits (CDN-served, not REST API)
   *   - Skill-specific descriptions (not generic repo-level text)
   *   - Fast (~200ms per file for small frontmatter)
   *   - Preserves API quota for detail/install flows
   */
  private async enrichDescriptions(items: MarketSkillSummary[]): Promise<void> {
    const ENRICH_TIMEOUT_MS = 3_000

    await Promise.all(
      items.map(async (item) => {
        try {
          const coords = parseSlug(item.slug)
          const candidates = buildSkillMdCandidates(coords.skillPath)
          const content = await fetchMarkdownContent({
            owner: coords.owner,
            repo: coords.repo,
            candidates,
            headers: {},  // CDN-only — no auth needed for public repos
            cdnOnly: true,
            timeoutMs: ENRICH_TIMEOUT_MS,
          })
          if (content) {
            const { description } = parseFrontmatter(content)
            if (description) item.description = description
          }
        } catch {
          // best-effort — leave description empty
        }
      }),
    )
  }

  // ─── Availability ──────────────────────────────────────────

  async checkAvailability(): Promise<boolean> {
    try {
      const resp = await fetchWithTimeout(
        'https://skills.sh/api/search?q=test&limit=1',
        { headers: { Accept: 'application/json' }, redirect: 'follow' },
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
 * Parse a skills.sh slug (id) into GitHub coordinates.
 *
 * skills.sh `id` format: "{owner}/{repo}/{skillId}"
 * The first two segments are ALWAYS the GitHub owner and repo name.
 * Everything after is the skill path within the repo.
 *
 * Examples:
 *   "github/awesome-copilot/git-commit"          → owner=github, repo=awesome-copilot, skillPath="git-commit"
 *   "openai/openai-agents-python/docs-sync"       → owner=openai, repo=openai-agents-python, skillPath="docs-sync"
 *   "cursor/plugins/deslop"                       → owner=cursor, repo=plugins, skillPath="deslop"
 *   "jiatastic/open-python-skills/python-backend" → owner=jiatastic, repo=open-python-skills, skillPath="python-backend"
 *
 * Note: "github/" is NOT a platform prefix — it's the actual GitHub org name (github.com/github).
 */
function parseSlug(slug: string): SkillsShCoordinates {
  const parts = slug.split('/')

  if (parts.length >= 2) {
    return { owner: parts[0], repo: parts[1], skillPath: parts.slice(2).join('/') }
  }

  throw new Error(`Invalid skills.sh slug: ${slug}`)
}

function transformSkill(raw: SkillsShSkill): MarketSkillSummary {
  // source = "{owner}/{repo}" — first segment is the GitHub org/user
  const author = raw.source?.split('/')[0] ?? raw.id.split('/')[0] ?? ''

  return {
    slug: raw.id,
    name: raw.name || raw.skillId || '',
    description: '',
    author,
    installs: raw.installs,
    repoUrl: idToGithubUrl(raw.id),
    marketplaceId: 'skills.sh',
  }
}

function idToGithubUrl(id: string): string | undefined {
  const parts = id.split('/')
  if (parts.length >= 2) {
    return `https://github.com/${parts[0]}/${parts[1]}`
  }
  return undefined
}

/**
 * Build candidate SKILL.md paths for a given skill path.
 *
 * Tries monorepo convention first (`skills/{id}/SKILL.md`), then direct
 * path, then repo root. Used by both enrichment and detail views.
 */
function buildSkillMdCandidates(skillPath: string): string[] {
  if (!skillPath) return ['SKILL.md']
  return [
    `skills/${skillPath}/SKILL.md`,
    `${skillPath}/SKILL.md`,
    'SKILL.md',
  ]
}
