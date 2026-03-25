// SPDX-License-Identifier: Apache-2.0

/**
 * Git platform abstraction — uniform interface for GitHub and GitLab APIs.
 *
 * Each platform adapter encapsulates the API differences (endpoints, auth
 * headers, project ID encoding, etc.) behind a common contract. Higher-level
 * code (UserRepoProvider, RepoSourceRegistry) interacts only with this
 * interface and never touches platform-specific details directly.
 */

import type { RepoSourcePlatform, MarketInstallPreview } from '../../../../src/shared/types'

// ─── Configuration ──────────────────────────────────────────

/** Parameters for a platform API request. */
export interface GitPlatformConfig {
  /** Repository owner / group */
  owner: string
  /** Repository name */
  repo: string
  /** API base URL (e.g. 'https://api.github.com', 'https://gitlab.com') */
  apiBase: string
  /** Branch override (undefined = default branch) */
  branch?: string
  /** Pre-built auth headers */
  headers: Record<string, string>
}

// ─── Tree / File types ──────────────────────────────────────

export interface RepoTreeEntry {
  path: string
  type: 'blob' | 'tree'
}

export interface RepoMeta {
  name: string
  description: string
  stars: number
  defaultBranch: string
  topics: string[]
}

// ─── Platform Interface ─────────────────────────────────────

export interface GitPlatform {
  readonly id: RepoSourcePlatform

  /** Build platform-specific auth headers from a PAT token. */
  buildAuthHeaders(token?: string): Record<string, string>

  /** Test connectivity — returns error message on failure, undefined on success. */
  testConnection(config: GitPlatformConfig): Promise<{ ok: boolean; error?: string }>

  /** Fetch repository metadata (name, description, stars, default branch). */
  fetchRepoMeta(config: GitPlatformConfig): Promise<RepoMeta | null>

  /** Fetch the SHA of the HEAD commit (for the configured branch or default). */
  fetchHeadCommit(config: GitPlatformConfig): Promise<string | null>

  /** Probe the repository for capability directories (lightweight, no tarball). */
  probeCapabilities(config: GitPlatformConfig): Promise<MarketInstallPreview>

  /** Fetch raw content of a single file. Returns empty string on failure. */
  fetchFileContent(config: GitPlatformConfig & { path: string }): Promise<string>

  /**
   * Download the full repository archive and extract to targetDir.
   * @returns Path to the extracted repo root directory.
   */
  downloadRepo(config: GitPlatformConfig & { targetDir: string }): Promise<string>
}
