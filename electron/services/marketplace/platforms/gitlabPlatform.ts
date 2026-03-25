// SPDX-License-Identifier: Apache-2.0

/**
 * GitLab platform adapter — implements the GitPlatform interface for
 * GitLab.com and self-hosted GitLab instances.
 *
 * Key differences from GitHub:
 *   - Project ID via URL-encoded path: encodeURIComponent('owner/repo')
 *   - Auth header: PRIVATE-TOKEN (not Bearer)
 *   - Repository tree: /api/v4/projects/:id/repository/tree
 *   - File content: /api/v4/projects/:id/repository/files/:path/raw
 *   - Tarball: /api/v4/projects/:id/repository/archive.tar.gz
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as tar from 'tar'

import type { GitPlatform, GitPlatformConfig, RepoMeta, RepoTreeEntry } from './types'
import type { MarketInstallPreview, ManagedCapabilityCategory } from '../../../../src/shared/types'
import { DIR_TO_CAPABILITY_CATEGORY, CAPABILITY_SKIP_DIRS } from '../../../../src/shared/types'
import { fetchWithTimeout } from '../utils/http'

// ─── Constants ──────────────────────────────────────────────

const PROBE_CAPABILITY_DIRS: Readonly<Record<string, ManagedCapabilityCategory>> = Object.fromEntries(
  Object.entries(DIR_TO_CAPABILITY_CATEGORY).filter(([dir]) => !(dir in CAPABILITY_SKIP_DIRS)),
) as Record<string, ManagedCapabilityCategory>

// ─── Helpers ────────────────────────────────────────────────

/** Build the GitLab project ID from owner/repo. */
function projectId(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`)
}

/** Build the GitLab API v4 project base URL. */
function projectUrl(config: GitPlatformConfig): string {
  return `${config.apiBase}/api/v4/projects/${projectId(config.owner, config.repo)}`
}

// ─── GitLabPlatform ─────────────────────────────────────────

export class GitLabPlatform implements GitPlatform {
  readonly id = 'gitlab' as const

  buildAuthHeaders(token?: string): Record<string, string> {
    const headers: Record<string, string> = {}
    if (token) headers['PRIVATE-TOKEN'] = token
    return headers
  }

  async testConnection(config: GitPlatformConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const resp = await fetchWithTimeout(projectUrl(config), { headers: config.headers }, 10_000)
      if (resp.ok) return { ok: true }
      if (resp.status === 404) return { ok: false, error: 'Project not found' }
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: 'Authentication failed — check your token' }
      }
      return { ok: false, error: `GitLab API error: ${resp.status}` }
    } catch (err) {
      return { ok: false, error: `Connection failed: ${err instanceof Error ? err.message : 'unknown'}` }
    }
  }

  async fetchRepoMeta(config: GitPlatformConfig): Promise<RepoMeta | null> {
    try {
      const resp = await fetchWithTimeout(projectUrl(config), { headers: config.headers })
      if (!resp.ok) return null
      const data = (await resp.json()) as Record<string, unknown>
      return {
        name: (data.name as string) ?? config.repo,
        description: (data.description as string) ?? '',
        stars: (data.star_count as number) ?? 0,
        defaultBranch: (data.default_branch as string) ?? 'main',
        topics: (data.topics as string[]) ?? [],
      }
    } catch {
      return null
    }
  }

  async fetchHeadCommit(config: GitPlatformConfig): Promise<string | null> {
    try {
      const branch = config.branch ?? 'HEAD'
      const url = `${projectUrl(config)}/repository/branches/${encodeURIComponent(branch)}`
      const resp = await fetchWithTimeout(url, { headers: config.headers })
      if (!resp.ok) {
        // If HEAD doesn't work, try default branch
        if (branch === 'HEAD') {
          const meta = await this.fetchRepoMeta(config)
          if (!meta) return null
          const url2 = `${projectUrl(config)}/repository/branches/${encodeURIComponent(meta.defaultBranch)}`
          const resp2 = await fetchWithTimeout(url2, { headers: config.headers })
          if (!resp2.ok) return null
          const data2 = (await resp2.json()) as { commit?: { id?: string } }
          return data2.commit?.id ?? null
        }
        return null
      }
      const data = (await resp.json()) as { commit?: { id?: string } }
      return data.commit?.id ?? null
    } catch {
      return null
    }
  }

  async probeCapabilities(config: GitPlatformConfig): Promise<MarketInstallPreview> {
    try {
      // Step 1: list root tree entries
      const treeUrl = `${projectUrl(config)}/repository/tree?per_page=100`
      const resp = await fetchWithTimeout(treeUrl, { headers: config.headers })
      if (!resp.ok) {
        return {
          isMultiCapability: false,
          capabilities: [{ name: config.repo, category: 'skill' }],
          skipped: [],
          probeStatus: 'degraded',
          probeMessage: `GitLab API error: ${resp.status}`,
        }
      }

      const entries = (await resp.json()) as Array<{ name: string; type: string }>
      const rootDirs = new Set(entries.filter((e) => e.type === 'tree').map((e) => e.name))

      const foundCapDirs = Object.entries(PROBE_CAPABILITY_DIRS)
        .filter(([dir]) => rootDirs.has(dir))
      const skipped = Object.entries(CAPABILITY_SKIP_DIRS)
        .filter(([dir]) => rootDirs.has(dir))
        .map(([dir, reason]) => ({ dir, reason }))

      if (foundCapDirs.length === 0) {
        return {
          isMultiCapability: false,
          capabilities: [{ name: config.repo, category: 'skill' }],
          skipped,
          probeStatus: 'ok',
        }
      }

      // Step 2: list each capability directory in parallel
      const capabilities: Array<{ name: string; category: ManagedCapabilityCategory }> = []

      await Promise.all(
        foundCapDirs.map(async ([dirName, category]) => {
          try {
            const dirUrl = `${projectUrl(config)}/repository/tree?path=${encodeURIComponent(dirName)}&per_page=100`
            const resp = await fetchWithTimeout(dirUrl, { headers: config.headers })
            if (!resp.ok) return

            const items = (await resp.json()) as Array<{ name: string; type: string }>

            if (category === 'skill') {
              for (const e of items) {
                if (e.type === 'tree' && !e.name.startsWith('.')) {
                  capabilities.push({ name: e.name, category: 'skill' })
                }
              }
            } else {
              for (const e of items) {
                if (e.type === 'blob' && e.name.endsWith('.md') && !e.name.startsWith('.')) {
                  capabilities.push({ name: e.name.replace(/\.md$/, ''), category })
                }
              }
            }
          } catch {
            // Skip on network error
          }
        }),
      )

      return {
        isMultiCapability: capabilities.length > 1,
        capabilities,
        skipped,
        probeStatus: 'ok',
      }
    } catch (err) {
      return {
        isMultiCapability: false,
        capabilities: [{ name: config.repo, category: 'skill' }],
        skipped: [],
        probeStatus: 'degraded',
        probeMessage: `Error: ${err instanceof Error ? err.message : 'unknown'}`,
      }
    }
  }

  async fetchFileContent(config: GitPlatformConfig & { path: string }): Promise<string> {
    try {
      const ref = config.branch ? `?ref=${encodeURIComponent(config.branch)}` : ''
      const filePath = encodeURIComponent(config.path)
      const url = `${projectUrl(config)}/repository/files/${filePath}/raw${ref}`
      const resp = await fetchWithTimeout(url, { headers: config.headers })
      if (!resp.ok) return ''
      return await resp.text()
    } catch {
      return ''
    }
  }

  async downloadRepo(config: GitPlatformConfig & { targetDir: string }): Promise<string> {
    const ref = config.branch ? `?sha=${encodeURIComponent(config.branch)}` : ''
    const url = `${projectUrl(config)}/repository/archive.tar.gz${ref}`

    const resp = await fetchWithTimeout(url, {
      headers: config.headers,
    }, 60_000)

    if (!resp.ok) {
      throw new Error(`GitLab tarball download failed: HTTP ${resp.status}`)
    }

    const tarballPath = path.join(config.targetDir, '__download__.tar.gz')
    const extractDir = path.join(config.targetDir, '__repo__')

    try {
      const buffer = Buffer.from(await resp.arrayBuffer())
      if (buffer.length === 0) {
        throw new Error(`Downloaded tarball is empty (0 bytes)`)
      }
      await fs.writeFile(tarballPath, buffer)
      await fs.mkdir(extractDir, { recursive: true })
      await tar.x({ cwd: extractDir, strip: 1, gzip: true, file: tarballPath })

      const entries = await fs.readdir(extractDir)
      if (entries.length === 0) {
        throw new Error('Tarball extraction produced an empty directory')
      }

      return extractDir
    } finally {
      await fs.rm(tarballPath, { force: true }).catch(() => {})
    }
  }
}
