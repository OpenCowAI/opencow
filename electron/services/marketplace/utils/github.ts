// SPDX-License-Identifier: Apache-2.0

/**
 * GitHub API utilities for marketplace adapters.
 *
 * Only the skills.sh adapter (which resolves content from GitHub repos)
 * uses these — ClawHub has its own REST API. Separated from the base class
 * so adapters that don't need GitHub don't inherit unused methods.
 */

/** Build GitHub API request headers (with optional PAT token). */
export function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}
