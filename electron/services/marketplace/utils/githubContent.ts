// SPDX-License-Identifier: Apache-2.0

/**
 * Shared GitHub content resolution utilities.
 *
 * Used by any adapter that fetches content from GitHub repos:
 *  - skills.sh (resolves skill detail/files from the underlying GitHub repo)
 *  - GitHub adapter (directly searches/fetches GitHub repos)
 *
 * Extracted to avoid code duplication between the two adapters.
 */

import { DIR_TO_CAPABILITY_CATEGORY, CAPABILITY_SKIP_DIRS } from '../../../../src/shared/types'
import type { MarketSkillDetail, MarketInstallPreview, ManagedCapabilityCategory } from '../../../../src/shared/types'
import { fetchWithTimeout } from './http'

// ─── Constants ───────────────────────────────────────────────

/** Skill bundle internal sub-directories (scripts, references, assets). */
const SKILL_BUNDLE_SUBDIRS = new Set(['scripts', 'references', 'assets'])

/** Capability root directories (skills, commands, agents, rules). */
const CAPABILITY_ROOT_DIRS = new Set(['skills', 'commands', 'agents', 'rules'])

/** All directories relevant for preview display (bundle + capability). */
const PREVIEW_DIRS = new Set([...SKILL_BUNDLE_SUBDIRS, ...CAPABILITY_ROOT_DIRS])

/**
 * Common default branch names, tried in order.
 * Covers 99%+ of GitHub repos (main became default in Oct 2020).
 */
export const DEFAULT_BRANCHES = ['main', 'master'] as const

/** Timeout for the CDN path (tight — it's a fast CDN). */
const RAW_TIMEOUT_MS = 6_000

// ─── Types ──────────────────────────────────────────────────

/** Minimal GitHub repo identity — reused across adapters and utils. */
export interface GitHubRepoCoordinates {
  owner: string
  repo: string
}

/** Base params that every GitHub content request needs. */
interface GitHubRequestParams extends GitHubRepoCoordinates {
  headers: Record<string, string>
  /** API base URL. Defaults to 'https://api.github.com' (supports GitHub Enterprise). */
  apiBase?: string
}

const GITHUB_API_BASE = 'https://api.github.com'

interface ContentFetchParams extends GitHubRequestParams {
  /** Ordered list of file paths to try (first hit wins). */
  candidates: string[]
  /**
   * Skip GitHub API fallback — CDN only (Phase 1).
   * Useful for best-effort enrichment where latency matters more than
   * completeness and API rate limits must be preserved.
   */
  cdnOnly?: boolean
  /** Override default CDN timeout (ms). */
  timeoutMs?: number
}

interface DirectoryFetchParams extends GitHubRequestParams {
  /** Sub-directory path within the repo (empty string = root). */
  dirPath: string
}

export interface RepoMeta {
  name: string
  description: string
  stars: number
  license?: string
  topics: string[]
}

// ─── Functions ──────────────────────────────────────────────

/**
 * Try fetching raw markdown content from a GitHub repo.
 *
 * Uses a two-phase strategy to maximise availability:
 *
 *   Phase 1 — raw.githubusercontent.com (CDN, **not** subject to API rate limits).
 *     Tries `main` then `master` branch for each candidate file.
 *     Works for public repos without auth; supports Bearer token for private repos.
 *
 *   Phase 2 — GitHub Contents API (rate-limited: 60 req/hr unauthenticated).
 *     Only reached when Phase 1 fails (e.g. non-standard default branch).
 *
 * Returns the content of the first hit, or empty string on total failure.
 */
export async function fetchMarkdownContent(params: ContentFetchParams): Promise<string> {
  const { owner, repo, candidates, headers, cdnOnly = false, timeoutMs, apiBase = GITHUB_API_BASE } = params

  // Phase 1: raw.githubusercontent.com — CDN-served, no API rate-limit impact.
  // Only pass Authorization (if present) — the CDN ignores API-specific headers.
  const rawHeaders: Record<string, string> = {}
  if (headers['Authorization']) rawHeaders['Authorization'] = headers['Authorization']

  const cdnTimeout = timeoutMs ?? RAW_TIMEOUT_MS

  for (const branch of DEFAULT_BRANCHES) {
    for (const candidate of candidates) {
      try {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${candidate}`
        const resp = await fetchWithTimeout(url, { headers: rawHeaders }, cdnTimeout)
        if (resp.ok) return await resp.text()
        // 404 → try next candidate / branch
      } catch {
        // Network error → try next
      }
    }
  }

  if (cdnOnly) return ''

  // Phase 2: GitHub Contents API (fallback for non-standard default branches).
  for (const candidate of candidates) {
    try {
      const url = `${apiBase}/repos/${owner}/${repo}/contents/${candidate}`
      const resp = await fetchWithTimeout(url, {
        headers: { ...headers, Accept: 'application/vnd.github.raw' },
      })
      if (resp.ok) return await resp.text()
    } catch {
      // Try next candidate
    }
  }

  return ''
}

/**
 * Fetch repository metadata (name, description, stars, license, topics).
 * Returns null on any failure — callers should treat as best-effort.
 */
export async function fetchRepoMeta(
  params: GitHubRequestParams,
  timeoutMs?: number,
): Promise<RepoMeta | null> {
  try {
    const apiBase = params.apiBase ?? GITHUB_API_BASE
    const resp = await fetchWithTimeout(
      `${apiBase}/repos/${params.owner}/${params.repo}`,
      { headers: params.headers },
      timeoutMs,
    )
    if (!resp.ok) return null

    const data = (await resp.json()) as Record<string, unknown>
    return {
      name: (data.name as string) ?? params.repo,
      description: (data.description as string) ?? '',
      stars: (data.stargazers_count as number) ?? 0,
      license: (data.license as { spdx_id?: string } | null)?.spdx_id ?? undefined,
      topics: (data.topics as string[]) ?? [],
    }
  } catch {
    return null
  }
}

/**
 * Resolve the actual directory path of a skill within a GitHub repo.
 *
 * Skills on skills.sh may live at:
 *   - `skills/{skillId}/` — monorepo convention (most common)
 *   - `{skillId}/`        — direct sub-directory
 *   - `` (root)           — standalone single-skill repo
 *
 * Probes via CDN (no rate limit) by checking for SKILL.md at each
 * candidate path. Returns the resolved dir path (e.g. "skills/git-commit")
 * or empty string for root-level skills.
 *
 * Falls back to `skillPath` if probing fails — callers should treat this
 * as best-effort.
 */
export async function resolveSkillRoot(
  params: GitHubRequestParams & { skillPath: string },
): Promise<string> {
  if (!params.skillPath) return ''

  const candidates = [
    `skills/${params.skillPath}`,
    params.skillPath,
  ]

  const rawHeaders: Record<string, string> = {}
  if (params.headers['Authorization']) rawHeaders['Authorization'] = params.headers['Authorization']

  for (const branch of DEFAULT_BRANCHES) {
    for (const dir of candidates) {
      try {
        const url = `https://raw.githubusercontent.com/${params.owner}/${params.repo}/${branch}/${dir}/SKILL.md`
        const resp = await fetchWithTimeout(url, { headers: rawHeaders }, 4_000)
        if (resp.ok) return dir
      } catch {
        // try next
      }
    }
  }

  // Fallback: return original skillPath (may not resolve, but best guess)
  return params.skillPath
}

/**
 * Fetch the directory listing and extract known bundle sub-directories
 * (scripts, references, assets).
 */
export async function fetchBundleFiles(
  params: DirectoryFetchParams,
): Promise<MarketSkillDetail['files']> {
  try {
    const apiBase = params.apiBase ?? GITHUB_API_BASE
    const dirUrl = `${apiBase}/repos/${params.owner}/${params.repo}/contents/${params.dirPath}`
    const resp = await fetchWithTimeout(dirUrl, { headers: params.headers })
    if (!resp.ok) return []

    const entries = (await resp.json()) as Array<{ name: string; type: string; path: string }>
    return entries
      .filter((e) => e.type === 'dir' && PREVIEW_DIRS.has(e.name))
      .map((e) => ({ path: e.path, type: e.name as 'script' | 'reference' | 'asset' }))
  } catch {
    return []
  }
}

// ─── Install Preview Probing ────────────────────────────────

/** Capability directory names recognised during pre-install probing (derived from shared constant). */
const PROBE_CAPABILITY_DIRS: Readonly<Record<string, ManagedCapabilityCategory>> = Object.fromEntries(
  Object.entries(DIR_TO_CAPABILITY_CATEGORY).filter(([dir]) => !(dir in CAPABILITY_SKIP_DIRS)),
) as Record<string, ManagedCapabilityCategory>

/** Directories intentionally skipped during probing (from shared constant). */
const PROBE_SKIP_DIRS = CAPABILITY_SKIP_DIRS

/**
 * Probe a GitHub repo's capability structure via the Contents API.
 *
 * This is a **lightweight** pre-install analysis that does NOT download the
 * tarball. Strategy:
 *
 *   1. List root directory (1 API call) → identify capability directories.
 *   2. List each found directory in parallel (1 call each, max 4).
 *      - skills/  → each sub-directory = one skill
 *      - commands/ | agents/ | rules/ → each .md file = one capability
 *
 * Total cost: 2–5 API calls, typically < 1 s.
 *
 * Falls back to a single-skill preview on any API failure — callers should
 * treat this as best-effort enrichment.
 */
export async function probeRepoCapabilities(
  params: GitHubRequestParams,
): Promise<MarketInstallPreview> {
  const { owner, repo, headers, apiBase = GITHUB_API_BASE } = params

  // Step 1: list root directory (1 API call)
  const rootUrl = `${apiBase}/repos/${owner}/${repo}/contents/`
  let rootEntries: Array<{ name: string; type: string }>
  try {
    const resp = await fetchWithTimeout(rootUrl, {
      headers: { ...headers, Accept: 'application/vnd.github+json' },
    })
    if (!resp.ok) {
      const reason = diagnoseGitHubError(resp.status, !!headers['Authorization'])
      return degradedFallback(repo, reason)
    }
    rootEntries = (await resp.json()) as Array<{ name: string; type: string }>
  } catch (err) {
    return degradedFallback(repo, `Network error: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  const rootDirNames = new Set(
    rootEntries.filter((e) => e.type === 'dir').map((e) => e.name),
  )

  // Identify capability dirs + skipped dirs
  const foundCapDirs = Object.entries(PROBE_CAPABILITY_DIRS)
    .filter(([dir]) => rootDirNames.has(dir))
  const skipped = Object.entries(PROBE_SKIP_DIRS)
    .filter(([dir]) => rootDirNames.has(dir))
    .map(([dir, reason]) => ({ dir, reason }))

  if (foundCapDirs.length === 0) {
    // Probe succeeded — repo genuinely has no capability directories
    return {
      isMultiCapability: false,
      capabilities: [{ name: repo, category: 'skill' }],
      skipped,
      probeStatus: 'ok',
    }
  }

  // Step 2: list each capability directory in parallel (1-4 API calls)
  const capabilities: Array<{ name: string; category: ManagedCapabilityCategory }> = []
  /** Track the worst HTTP status seen during directory fetches (0 = network error). */
  let worstDirStatus = -1

  await Promise.all(
    foundCapDirs.map(async ([dirName, category]) => {
      try {
        const dirUrl = `${apiBase}/repos/${owner}/${repo}/contents/${dirName}`
        const resp = await fetchWithTimeout(dirUrl, {
          headers: { ...headers, Accept: 'application/vnd.github+json' },
        })
        if (!resp.ok) {
          worstDirStatus = Math.max(worstDirStatus, resp.status)
          return
        }

        const entries = (await resp.json()) as Array<{ name: string; type: string }>

        if (category === 'skill') {
          for (const e of entries) {
            if (e.type === 'dir' && !e.name.startsWith('.')) {
              capabilities.push({ name: e.name, category: 'skill' })
            }
          }
        } else {
          for (const e of entries) {
            if (e.type === 'file' && e.name.endsWith('.md') && !e.name.startsWith('.')) {
              capabilities.push({ name: e.name.replace(/\.md$/, ''), category })
            }
          }
        }
      } catch {
        worstDirStatus = Math.max(worstDirStatus, 0)
      }
    }),
  )

  // If some directory fetches failed and we got zero capabilities,
  // mark as degraded with the actual error diagnosis.
  const dirFetchFailed = worstDirStatus >= 0
  const probeStatus = dirFetchFailed && capabilities.length === 0 ? 'degraded' as const : 'ok' as const
  const probeMessage = dirFetchFailed && capabilities.length === 0
    ? (worstDirStatus > 0
        ? diagnoseGitHubError(worstDirStatus, !!headers['Authorization'])
        : 'Network error while fetching capability directories')
    : undefined

  return {
    isMultiCapability: capabilities.length > 1,
    capabilities,
    skipped,
    probeStatus,
    probeMessage,
  }
}

/**
 * Produce a human-readable error message for a GitHub API failure.
 *
 * Context-aware: when the request already carried an Authorization header
 * the message avoids the misleading "add a token" suggestion and instead
 * points at the likely real cause (permissions, scopes, private repo).
 */
function diagnoseGitHubError(status: number, hasAuth: boolean): string {
  if (status === 403) {
    return hasAuth
      ? 'GitHub API rate limit or permission denied — check that your token has the "repo" scope'
      : 'GitHub API rate limit exceeded — add a token to this repo source for higher limits'
  }
  if (status === 401) {
    return 'GitHub authentication failed — your token may be expired or invalid'
  }
  if (status === 404) {
    return hasAuth
      ? 'Repository not found — check the URL or token permissions'
      : 'Repository not found or private — add a token for private repos'
  }
  return `GitHub API error (${status})`
}

/**
 * Degraded fallback — probe FAILED, not "repo is truly single skill".
 *
 * Returns a minimal single-skill preview with `probeStatus: 'degraded'`
 * so the UI can show a warning instead of presenting false results confidently.
 */
function degradedFallback(repo: string, reason: string): MarketInstallPreview {
  return {
    isMultiCapability: false,
    capabilities: [{ name: repo, category: 'skill' }],
    skipped: [],
    probeStatus: 'degraded',
    probeMessage: reason,
  }
}
