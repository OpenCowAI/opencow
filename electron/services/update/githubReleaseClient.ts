// SPDX-License-Identifier: Apache-2.0

/**
 * githubReleaseClient — Fetches the latest GitHub Release for the repository.
 *
 * Responsibilities:
 *   - HTTP request with timeout and abort handling
 *   - JSON response parsing and validation
 *   - GitHub API authentication headers
 *
 * This module has NO scheduling, version comparison, or UI dispatch logic.
 *
 * @module
 */

import { createLogger } from '../../platform/logger'
import { parseSemVer } from './semver'
import type { ReleaseInfo, ReleaseAsset } from './releaseTypes'

const log = createLogger('GitHubReleaseClient')

// ─── Constants ──────────────────────────────────────────────────────

const GITHUB_OWNER = 'OpenCowAI'
const GITHUB_REPO = 'opencow'
const RELEASES_LATEST_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const REQUEST_TIMEOUT_MS = 15_000

// ─── GitHub API Headers ─────────────────────────────────────────────

/**
 * Build GitHub API request headers.
 *
 * Self-contained — does NOT import from marketplace utilities.
 * The update checker only needs public read access to Releases;
 * no PAT token is required (public repo).
 */
function buildGitHubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

// ─── Client ─────────────────────────────────────────────────────────

/**
 * Fetch the latest non-draft, non-prerelease GitHub Release.
 * Returns null on network error or if the response is invalid.
 */
export async function fetchLatestRelease(
  fetchFn: typeof globalThis.fetch,
): Promise<ReleaseInfo | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    const response = await fetchFn(RELEASES_LATEST_URL, {
      headers: buildGitHubHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      log.warn(`GitHub API responded with ${response.status} ${response.statusText}`)
      return null
    }

    const data = (await response.json()) as Record<string, unknown>
    const tagName = typeof data.tag_name === 'string' ? data.tag_name : ''
    const version = tagName.replace(/^v/, '')

    if (!parseSemVer(version)) {
      log.warn(`Invalid tag version: ${tagName}`)
      return null
    }

    const assets: ReleaseAsset[] = Array.isArray(data.assets)
      ? (data.assets as Record<string, unknown>[]).map((a) => ({
          name: String(a.name ?? ''),
          downloadUrl: String(a.browser_download_url ?? ''),
          size: Number(a.size ?? 0),
          contentType: String(a.content_type ?? ''),
        }))
      : []

    return {
      version,
      tagName,
      htmlUrl: String(data.html_url ?? ''),
      body: String(data.body ?? ''),
      publishedAt: String(data.published_at ?? ''),
      assets,
    }
  } catch (err) {
    // Silently handle network errors — update check is best-effort
    if (err instanceof Error && err.name === 'AbortError') {
      log.warn('GitHub API request timed out')
    } else {
      log.warn('Failed to fetch latest release', err)
    }
    return null
  }
}
