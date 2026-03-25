// SPDX-License-Identifier: Apache-2.0

/**
 * RepoSourceRegistry — manages user-registered repository sources.
 *
 * Coordinates three concerns:
 *   1. CRUD operations on the repo_sources DB table
 *   2. Credential management via a dedicated CredentialStore
 *   3. Dynamic MarketplaceProvider lifecycle (register/unregister)
 *
 * Each registered source becomes a UserRepoProvider that plugs into
 * MarketplaceService, enabling search, preview, and install through
 * the standard marketplace pipeline.
 */

import { nanoid } from 'nanoid'
import type { Kysely } from 'kysely'

import type { Database } from '../../database/types'
import type { RepoSource, RepoSourceInput, RepoSourceUpdateInput, RepoSourcePlatform, RepoSourceBrowseResult } from '../../../src/shared/types'
import type { CredentialStore } from '../provider/credentialStore'

/** Repo source credentials: dynamic string keys (`repo:<sourceId>`) → PAT token. */
type RepoCredentials = Record<string, string>
import type { MarketplaceService } from './service'
import { UserRepoProvider } from './providers/userRepoProvider'
import { getPlatform } from './platforms'
import { parseRepoUrl, type ParsedRepoUrl } from './utils/urlParser'
import { createLogger } from '../../platform/logger'

const log = createLogger('RepoSourceRegistry')

// ─── Credential key helpers ─────────────────────────────────

function credentialKey(sourceId: string): string {
  return `repo:${sourceId}`
}

// ─── Types ──────────────────────────────────────────────────

interface RepoSourceRegistryDeps {
  db: Kysely<Database>
  credentialStore: CredentialStore<RepoCredentials>
  marketplaceService: MarketplaceService
}

/** Typed shape of the repo_sources LEFT JOIN repo_source_sync query result. */
interface RepoSourceJoinRow {
  id: string
  name: string
  url: string
  platform: string
  branch: string | null
  credential_key: string | null
  enabled: number
  created_at: number
  updated_at: number
  // LEFT JOIN — sync columns are nullable
  sync_status: string | null
  last_synced_at: number | null
  last_commit: string | null
  error_message: string | null
}

// ─── Registry ───────────────────────────────────────────────

export class RepoSourceRegistry {
  private readonly db: Kysely<Database>
  private readonly creds: CredentialStore<RepoCredentials>
  private readonly marketplace: MarketplaceService
  /** Track live providers by source ID for fast lookup on remove. */
  private readonly providers = new Map<string, UserRepoProvider>()

  constructor(deps: RepoSourceRegistryDeps) {
    this.db = deps.db
    this.creds = deps.credentialStore
    this.marketplace = deps.marketplaceService
  }

  // ─── CRUD ─────────────────────────────────────────────────

  async list(): Promise<RepoSource[]> {
    const rows = await this.db
      .selectFrom('repo_sources')
      .leftJoin('repo_source_sync', 'repo_source_sync.source_id', 'repo_sources.id')
      .selectAll('repo_sources')
      .select([
        'repo_source_sync.status as sync_status',
        'repo_source_sync.last_synced_at',
        'repo_source_sync.last_commit',
        'repo_source_sync.error_message',
      ])
      .orderBy('repo_sources.created_at', 'desc')
      .execute() as unknown as RepoSourceJoinRow[]

    return rows.map((r) => this.toRepoSource(r))
  }

  async create(input: RepoSourceInput): Promise<RepoSource> {
    // 1. Parse URL → detect platform
    const parsed = parseRepoUrl(input.url)
    const platform = input.platform ?? parsed.platform
    const id = nanoid()
    const now = Date.now()

    // 2. Store credential if provided
    let credKey: string | null = null
    if (input.auth?.method === 'pat' && input.auth.token) {
      credKey = credentialKey(id)
      await this.creds.update(credKey, input.auth.token)
    }

    // 3. Insert into DB
    const displayName = input.name || `${parsed.owner}/${parsed.repo}`
    await this.db.insertInto('repo_sources').values({
      id,
      name: displayName,
      url: input.url.trim(),
      platform,
      branch: input.branch ?? null,
      credential_key: credKey,
      enabled: 1,
      created_at: now,
      updated_at: now,
    }).execute()

    // Insert initial sync state
    await this.db.insertInto('repo_source_sync').values({
      source_id: id,
      status: 'idle',
      last_synced_at: null,
      last_commit: null,
      error_message: null,
    }).execute()

    // 4. Create and register dynamic provider
    const token = input.auth?.method === 'pat' ? input.auth.token : undefined
    await this.registerDynamic(id, {
      name: displayName,
      url: input.url.trim(),
      platform,
      parsed,
      branch: input.branch,
      token,
    })

    log.info(`Added repo source "${input.name}" (${platform}: ${parsed.owner}/${parsed.repo})`)

    // 5. Return
    return this.get(id)
  }

  async update(id: string, input: RepoSourceUpdateInput): Promise<RepoSource> {
    const now = Date.now()
    const patch: Record<string, unknown> = { updated_at: now }

    if (input.name !== undefined) patch.name = input.name
    if (input.branch !== undefined) patch.branch = input.branch || null
    if (input.enabled !== undefined) patch.enabled = input.enabled ? 1 : 0

    // Handle credential update
    if (input.auth) {
      if (input.auth.method === 'pat' && input.auth.token) {
        const key = credentialKey(id)
        await this.creds.update(key, input.auth.token)
        patch.credential_key = key
      } else if (input.auth.method === 'none') {
        const existing = await this.db.selectFrom('repo_sources')
          .select('credential_key')
          .where('id', '=', id)
          .executeTakeFirst()
        if (existing?.credential_key) {
          await this.creds.remove(existing.credential_key)
        }
        patch.credential_key = null
      }
    }

    await this.db.updateTable('repo_sources')
      .set(patch)
      .where('id', '=', id)
      .execute()

    // Re-create provider with updated config
    const source = await this.get(id)
    this.unregisterDynamic(id)
    if (source.enabled) {
      const parsed = parseRepoUrl(source.url)
      const token = source.hasCredential
        ? await this.getToken(id)
        : undefined
      await this.registerDynamic(id, {
        name: source.name,
        url: source.url,
        platform: source.platform,
        parsed,
        branch: source.branch ?? undefined,
        token,
      })
    }

    return source
  }

  async remove(id: string): Promise<void> {
    // 1. Unregister provider
    this.unregisterDynamic(id)

    // 2. Remove credential
    const existing = await this.db.selectFrom('repo_sources')
      .select('credential_key')
      .where('id', '=', id)
      .executeTakeFirst()
    if (existing?.credential_key) {
      await this.creds.remove(existing.credential_key)
    }

    // 3. Delete from DB (cascades to repo_source_sync)
    await this.db.deleteFrom('repo_sources')
      .where('id', '=', id)
      .execute()

    log.info(`Removed repo source ${id}`)
  }

  // ─── Operations ───────────────────────────────────────────

  async testConnection(id: string): Promise<{ ok: boolean; error?: string }> {
    const provider = this.providers.get(id)
    if (!provider) {
      return { ok: false, error: 'Source not registered — try re-enabling it' }
    }
    return provider.testConnection()
  }

  async sync(id: string): Promise<RepoSource> {
    const provider = this.providers.get(id)
    if (!provider) throw new Error('Source not registered — try re-enabling it')

    // Mark syncing
    await this.db.updateTable('repo_source_sync')
      .set({ status: 'syncing', error_message: null })
      .where('source_id', '=', id)
      .execute()

    try {
      const commit = await provider.fetchHeadCommit()

      await this.db.updateTable('repo_source_sync')
        .set({
          status: 'idle',
          last_synced_at: Date.now(),
          last_commit: commit,
          error_message: null,
        })
        .where('source_id', '=', id)
        .execute()

      log.info(`Synced repo source ${id}: commit=${commit?.slice(0, 8) ?? 'unknown'}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      await this.db.updateTable('repo_source_sync')
        .set({ status: 'error', error_message: msg })
        .where('source_id', '=', id)
        .execute()
      log.warn(`Sync failed for repo source ${id}:`, err)
    }

    return this.get(id)
  }

  async browse(id: string): Promise<RepoSourceBrowseResult> {
    const provider = this.providers.get(id)
    if (!provider) {
      return { capabilities: [], status: 'error', message: 'Source not registered — try re-enabling it' }
    }
    try {
      const preview = await provider.getProbeResult()
      return {
        capabilities: preview.capabilities,
        status: preview.probeStatus === 'degraded' ? 'degraded' : 'ok',
        message: preview.probeMessage,
      }
    } catch (err) {
      return {
        capabilities: [],
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to browse capabilities',
      }
    }
  }

  // ─── Lifecycle ────────────────────────────────────────────

  /**
   * Restore all enabled repo sources as dynamic MarketplaceProviders.
   * Called once during application startup.
   */
  async restoreProviders(): Promise<void> {
    const rows = await this.db.selectFrom('repo_sources')
      .selectAll()
      .where('enabled', '=', 1)
      .execute()

    let restored = 0
    for (const row of rows) {
      try {
        const parsed = parseRepoUrl(row.url)
        const token = row.credential_key ? await this.getToken(row.id) : undefined
        await this.registerDynamic(row.id, {
          name: row.name,
          url: row.url,
          platform: row.platform as RepoSourcePlatform,
          parsed,
          branch: row.branch ?? undefined,
          token,
        })
        restored++
      } catch (err) {
        log.warn(`Failed to restore repo source ${row.id} (${row.name}):`, err)
      }
    }

    if (restored > 0) {
      log.info(`Restored ${restored} repo source provider(s)`)
    }
  }

  // ─── Private helpers ──────────────────────────────────────

  private async get(id: string): Promise<RepoSource> {
    const row = await this.db
      .selectFrom('repo_sources')
      .leftJoin('repo_source_sync', 'repo_source_sync.source_id', 'repo_sources.id')
      .selectAll('repo_sources')
      .select([
        'repo_source_sync.status as sync_status',
        'repo_source_sync.last_synced_at',
        'repo_source_sync.last_commit',
        'repo_source_sync.error_message',
      ])
      .where('repo_sources.id', '=', id)
      .executeTakeFirstOrThrow() as unknown as RepoSourceJoinRow

    return this.toRepoSource(row)
  }

  private async getToken(sourceId: string): Promise<string | undefined> {
    const key = credentialKey(sourceId)
    try {
      return await this.creds.get(key)
    } catch {
      return undefined
    }
  }

  private async registerDynamic(
    sourceId: string,
    params: {
      name: string
      url: string
      platform: RepoSourcePlatform
      parsed: ParsedRepoUrl
      branch?: string
      token?: string
    },
  ): Promise<void> {
    const gitPlatform = getPlatform(params.platform)
    const provider = new UserRepoProvider({
      sourceId,
      name: params.name,
      url: params.url,
      platform: gitPlatform,
      parsedUrl: params.parsed,
      branch: params.branch,
      token: params.token,
    })

    this.providers.set(sourceId, provider)
    this.marketplace.registerProvider(provider)
  }

  private unregisterDynamic(sourceId: string): void {
    const provider = this.providers.get(sourceId)
    if (provider) {
      this.marketplace.unregisterProvider(provider.id)
      this.providers.delete(sourceId)
    }
  }

  private toRepoSource(row: RepoSourceJoinRow): RepoSource {
    const parsed = parseRepoUrl(row.url)
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      slug: `${parsed.owner}/${parsed.repo}`,
      platform: row.platform as RepoSourcePlatform,
      branch: row.branch,
      hasCredential: !!row.credential_key,
      enabled: row.enabled === 1,
      syncStatus: (row.sync_status ?? 'idle') as RepoSource['syncStatus'],
      lastSyncedAt: row.last_synced_at,
      lastCommit: row.last_commit,
      syncError: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
