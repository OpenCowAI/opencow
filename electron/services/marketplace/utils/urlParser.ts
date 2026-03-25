// SPDX-License-Identifier: Apache-2.0

/**
 * Git repository URL parser.
 *
 * Accepts various URL formats and extracts platform, owner, repo, and API base.
 * Supports GitHub.com, GitLab.com, and self-hosted GitLab instances.
 */

import type { RepoSourcePlatform } from '../../../../src/shared/types'

export interface ParsedRepoUrl {
  platform: RepoSourcePlatform
  owner: string
  repo: string
  /** API base URL (e.g. 'https://api.github.com' or 'https://gitlab.example.com') */
  apiBase: string
}

/**
 * Parse a repository URL into structured coordinates.
 *
 * Supported formats:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - https://gitlab.com/group/repo
 *  - https://gitlab.com/group/subgroup/repo
 *  - https://self-hosted-gitlab.com/group/repo
 *  - owner/repo (shorthand, defaults to GitHub)
 *
 * @throws Error for unrecognised or malformed URLs.
 */
export function parseRepoUrl(url: string): ParsedRepoUrl {
  const trimmed = url.trim()

  // ── Shorthand: owner/repo (no protocol) ─────────────────────
  if (!trimmed.includes('://') && !trimmed.includes('@')) {
    const parts = trimmed.replace(/\.git$/, '').split('/')
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        platform: 'github',
        owner: parts[0],
        repo: parts[1],
        apiBase: 'https://api.github.com',
      }
    }
    throw new Error(`Invalid repository shorthand: "${trimmed}". Expected "owner/repo".`)
  }

  // ── Full URL ────────────────────────────────────────────────
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Invalid repository URL: "${trimmed}"`)
  }

  // Strip .git suffix and leading/trailing slashes
  const pathname = parsed.pathname.replace(/\.git$/, '').replace(/^\/|\/$/g, '')
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length < 2) {
    throw new Error(
      `URL must contain at least owner and repo: "${trimmed}"`,
    )
  }

  const host = parsed.hostname.toLowerCase()

  // ── GitHub ──────────────────────────────────────────────────
  if (host === 'github.com' || host === 'www.github.com') {
    return {
      platform: 'github',
      owner: segments[0],
      repo: segments[1],
      apiBase: 'https://api.github.com',
    }
  }

  // ── GitLab.com ──────────────────────────────────────────────
  if (host === 'gitlab.com' || host === 'www.gitlab.com') {
    // GitLab supports nested groups: group/subgroup/repo
    // Owner = everything except the last segment
    const repo = segments[segments.length - 1]
    const owner = segments.slice(0, -1).join('/')
    return {
      platform: 'gitlab',
      owner,
      repo,
      apiBase: 'https://gitlab.com',
    }
  }

  // ── Self-hosted GitLab (heuristic: assume GitLab for non-GitHub hosts) ──
  const repo = segments[segments.length - 1]
  const owner = segments.slice(0, -1).join('/')
  return {
    platform: 'gitlab',
    owner,
    repo,
    apiBase: `${parsed.protocol}//${parsed.host}`,
  }
}

/**
 * Build the full Git clone URL from parsed coordinates.
 *
 * Returns the HTTPS clone URL (works with both PAT auth and public repos).
 */
export function buildCloneUrl(parsed: ParsedRepoUrl): string {
  if (parsed.platform === 'github') {
    return `https://github.com/${parsed.owner}/${parsed.repo}.git`
  }
  return `${parsed.apiBase}/${parsed.owner}/${parsed.repo}.git`
}
