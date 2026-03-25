// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub platform adapter — wraps existing GitHub utilities behind the
 * GitPlatform interface.
 *
 * All heavy lifting is delegated to the shared utilities in utils/:
 *   - githubHeaders()          → utils/github.ts
 *   - fetchMarkdownContent()   → utils/githubContent.ts
 *   - fetchRepoMeta()          → utils/githubContent.ts
 *   - probeRepoCapabilities()  → utils/githubContent.ts
 *   - downloadAndExtractRepo() → utils/tarball.ts
 *   - fetchWithTimeout()       → utils/http.ts
 */

import type { GitPlatform, GitPlatformConfig, RepoMeta, RepoTreeEntry } from './types'
import type { MarketInstallPreview } from '../../../../src/shared/types'
import { githubHeaders } from '../utils/github'
import {
  fetchMarkdownContent,
  fetchRepoMeta as ghFetchRepoMeta,
  probeRepoCapabilities,
} from '../utils/githubContent'
import { downloadAndExtractRepo } from '../utils/tarball'
import { fetchWithTimeout } from '../utils/http'

export class GitHubPlatform implements GitPlatform {
  readonly id = 'github' as const

  buildAuthHeaders(token?: string): Record<string, string> {
    return githubHeaders(token)
  }

  async testConnection(config: GitPlatformConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const url = `${config.apiBase}/repos/${config.owner}/${config.repo}`
      const resp = await fetchWithTimeout(url, { headers: config.headers }, 10_000)
      if (resp.ok) return { ok: true }
      if (resp.status === 404) return { ok: false, error: 'Repository not found' }
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: 'Authentication failed — check your token' }
      }
      return { ok: false, error: `GitHub API error: ${resp.status}` }
    } catch (err) {
      return { ok: false, error: `Connection failed: ${err instanceof Error ? err.message : 'unknown'}` }
    }
  }

  async fetchRepoMeta(config: GitPlatformConfig): Promise<RepoMeta | null> {
    const meta = await ghFetchRepoMeta({ owner: config.owner, repo: config.repo, headers: config.headers, apiBase: config.apiBase })
    if (!meta) return null
    return {
      name: meta.name,
      description: meta.description,
      stars: meta.stars,
      defaultBranch: 'main', // Filled by API response below
      topics: meta.topics,
    }
  }

  async fetchHeadCommit(config: GitPlatformConfig): Promise<string | null> {
    try {
      const branch = config.branch ?? 'HEAD'
      const url = `${config.apiBase}/repos/${config.owner}/${config.repo}/commits/${branch}`
      const resp = await fetchWithTimeout(url, {
        headers: { ...config.headers, Accept: 'application/vnd.github.sha' },
      })
      if (!resp.ok) return null
      return (await resp.text()).trim()
    } catch {
      return null
    }
  }

  async probeCapabilities(config: GitPlatformConfig): Promise<MarketInstallPreview> {
    return probeRepoCapabilities({
      owner: config.owner,
      repo: config.repo,
      headers: config.headers,
      apiBase: config.apiBase,
    })
  }

  async fetchFileContent(config: GitPlatformConfig & { path: string }): Promise<string> {
    return fetchMarkdownContent({
      owner: config.owner,
      repo: config.repo,
      candidates: [config.path],
      headers: config.headers,
      apiBase: config.apiBase,
    })
  }

  async downloadRepo(config: GitPlatformConfig & { targetDir: string }): Promise<string> {
    return downloadAndExtractRepo({
      owner: config.owner,
      repo: config.repo,
      headers: config.headers,
      targetDir: config.targetDir,
    })
  }
}
