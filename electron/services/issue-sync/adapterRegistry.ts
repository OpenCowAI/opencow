// SPDX-License-Identifier: Apache-2.0

import type { IssueProvider } from '../../../src/shared/types'
import type { RemoteAdapter, RemoteWriteAdapter } from './remoteAdapter'
import { GitHubAdapter } from './adapters/githubAdapter'
import { GitLabAdapter } from './adapters/gitlabAdapter'
import { LinearAdapter } from './adapters/linearAdapter'

/** Parsed metadata for Linear providers. */
interface LinearProviderMetadata {
  teamId: string
  teamKey: string
  tokenType?: 'apiKey' | 'accessToken'
}

/**
 * Factory that creates the appropriate {@link RemoteAdapter} for a given provider config.
 *
 * Stateless — each call produces a fresh adapter instance with the decrypted token.
 */
export class AdapterRegistry {
  /**
   * Create a RemoteAdapter for the given provider (read-only operations).
   * @param provider  Provider config from the DB.
   * @param token     Decrypted auth token (retrieved from CredentialStore beforehand).
   */
  createAdapter(provider: IssueProvider, token: string): RemoteAdapter {
    return this.createWriteAdapter(provider, token)
  }

  /**
   * Create a RemoteWriteAdapter for the given provider (read + write operations).
   *
   * All current adapters (GitHub, GitLab) implement the full write interface.
   * Use this method when you need write capabilities (PushEngine, etc.).
   *
   * @param provider  Provider config from the DB.
   * @param token     Decrypted auth token (retrieved from CredentialStore beforehand).
   */
  createWriteAdapter(provider: IssueProvider, token: string): RemoteWriteAdapter {
    switch (provider.platform) {
      case 'github':
        return new GitHubAdapter({
          owner: provider.repoOwner,
          repo: provider.repoName,
          token,
          apiBaseUrl: provider.apiBaseUrl ?? undefined,
        })

      case 'gitlab':
        return new GitLabAdapter({
          owner: provider.repoOwner,
          repo: provider.repoName,
          token,
          apiBaseUrl: provider.apiBaseUrl ?? undefined,
        })

      case 'linear': {
        const meta = parseLinearMetadata(provider)
        return new LinearAdapter({
          teamId: meta.teamId,
          teamKey: meta.teamKey,
          token,
          tokenType: meta.tokenType,
        })
      }

      default:
        throw new Error(`Unsupported issue provider platform: ${provider.platform}`)
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Parse the JSON `metadata` field from a Linear provider row.
 *
 * Linear providers store platform-specific config (teamId, teamKey, tokenType)
 * in the generic `metadata` JSON column instead of `repoOwner`/`repoName`.
 *
 * For Linear:
 * - `repoOwner` → workspace slug (for display only)
 * - `repoName`  → team key (e.g., "ENG", for display only)
 * - `metadata`  → `{ teamId, teamKey, tokenType }` (for API calls)
 */
function parseLinearMetadata(provider: IssueProvider): LinearProviderMetadata {
  if (!provider.metadata) {
    throw new Error(
      `Linear provider ${provider.id} is missing required metadata. ` +
        'Expected JSON with teamId and teamKey.',
    )
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  try {
    const parsed = JSON.parse(provider.metadata)
    if (!parsed.teamId || !parsed.teamKey) {
      throw new Error('Missing teamId or teamKey in metadata')
    }
    if (!UUID_RE.test(parsed.teamId)) {
      throw new Error(
        `Invalid teamId "${parsed.teamId}" — must be a UUID. ` +
          'Find it in Linear → Settings → Team → General.',
      )
    }
    return {
      teamId: parsed.teamId,
      teamKey: parsed.teamKey,
      tokenType: parsed.tokenType ?? 'apiKey',
    }
  } catch (err) {
    throw new Error(
      `Invalid metadata for Linear provider ${provider.id}: ` +
        (err instanceof Error ? err.message : String(err)),
      { cause: err },
    )
  }
}
