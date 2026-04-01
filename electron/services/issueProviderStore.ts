// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, IssueProviderTable } from '../database/types'
import type { IssueProvider, IssueProviderPlatform, IssueSyncDirection } from '../../src/shared/types'

/**
 * Data-access layer for the `issue_providers` table.
 *
 * Follows the same row↔domain pattern as {@link IssueStore}.
 */
export class IssueProviderStore {
  constructor(private readonly db: Kysely<Database>) {}

  async add(provider: IssueProvider): Promise<void> {
    await this.db
      .insertInto('issue_providers')
      .values(providerToRow(provider))
      .execute()
  }

  async get(id: string): Promise<IssueProvider | null> {
    const row = await this.db
      .selectFrom('issue_providers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row ? rowToProvider(row) : null
  }

  async list(projectId: string): Promise<IssueProvider[]> {
    const rows = await this.db
      .selectFrom('issue_providers')
      .selectAll()
      .where('project_id', '=', projectId)
      .orderBy('created_at', 'asc')
      .execute()

    return rows.map(rowToProvider)
  }

  async listEnabled(): Promise<IssueProvider[]> {
    const rows = await this.db
      .selectFrom('issue_providers')
      .selectAll()
      .where('sync_enabled', '=', 1)
      .orderBy('created_at', 'asc')
      .execute()

    return rows.map(rowToProvider)
  }

  async update(id: string, patch: Partial<IssueProvider>): Promise<IssueProvider | null> {
    const setClauses = patchToRow(patch)
    if (Object.keys(setClauses).length === 0) {
      return this.get(id)
    }

    await this.db
      .updateTable('issue_providers')
      .set({ ...setClauses, updated_at: Date.now() })
      .where('id', '=', id)
      .execute()

    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('issue_providers')
      .where('id', '=', id)
      .executeTakeFirst()

    return (result?.numDeletedRows ?? 0n) > 0n
  }

  /** Find a provider by repo coordinates — used for uniqueness validation. */
  async getByRepo(
    projectId: string,
    platform: IssueProviderPlatform,
    repoOwner: string,
    repoName: string,
  ): Promise<IssueProvider | null> {
    const row = await this.db
      .selectFrom('issue_providers')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('platform', '=', platform)
      .where('repo_owner', '=', repoOwner)
      .where('repo_name', '=', repoName)
      .executeTakeFirst()

    return row ? rowToProvider(row) : null
  }
}

// ─── Row ↔ Domain object mappers ─────────────────────────────────────────

function rowToProvider(row: IssueProviderTable): IssueProvider {
  return {
    id: row.id,
    projectId: row.project_id,
    platform: row.platform as IssueProviderPlatform,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    apiBaseUrl: row.api_base_url,
    authTokenRef: row.auth_token_ref,
    authStorage: row.auth_storage as IssueProvider['authStorage'],
    syncEnabled: row.sync_enabled === 1,
    syncIntervalS: row.sync_interval_s,
    lastSyncedAt: row.last_synced_at,
    // Phase 2
    syncDirection: row.sync_direction as IssueSyncDirection,
    syncCursor: row.sync_cursor,
    // Linear integration
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function providerToRow(provider: IssueProvider): IssueProviderTable {
  return {
    id: provider.id,
    project_id: provider.projectId,
    platform: provider.platform,
    repo_owner: provider.repoOwner,
    repo_name: provider.repoName,
    api_base_url: provider.apiBaseUrl,
    auth_token_ref: provider.authTokenRef,
    auth_storage: provider.authStorage,
    sync_enabled: provider.syncEnabled ? 1 : 0,
    sync_interval_s: provider.syncIntervalS,
    last_synced_at: provider.lastSyncedAt,
    // Phase 2
    sync_direction: provider.syncDirection,
    sync_cursor: provider.syncCursor,
    // Linear integration
    metadata: provider.metadata,
    created_at: provider.createdAt,
    updated_at: provider.updatedAt,
  }
}

function patchToRow(patch: Partial<IssueProvider>): Partial<IssueProviderTable> {
  const row: Partial<IssueProviderTable> = {}

  if (patch.platform !== undefined) row.platform = patch.platform
  if (patch.repoOwner !== undefined) row.repo_owner = patch.repoOwner
  if (patch.repoName !== undefined) row.repo_name = patch.repoName
  if (patch.apiBaseUrl !== undefined) row.api_base_url = patch.apiBaseUrl
  if (patch.authTokenRef !== undefined) row.auth_token_ref = patch.authTokenRef
  if (patch.authStorage !== undefined) row.auth_storage = patch.authStorage
  if (patch.syncEnabled !== undefined) row.sync_enabled = patch.syncEnabled ? 1 : 0
  if (patch.syncIntervalS !== undefined) row.sync_interval_s = patch.syncIntervalS
  if (patch.lastSyncedAt !== undefined) row.last_synced_at = patch.lastSyncedAt
  // Phase 2
  if (patch.syncDirection !== undefined) row.sync_direction = patch.syncDirection
  if (patch.syncCursor !== undefined) row.sync_cursor = patch.syncCursor
  // Linear integration
  if (patch.metadata !== undefined) row.metadata = patch.metadata

  return row
}
