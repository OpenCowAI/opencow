// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database, IssueSyncLogTable } from '../../database/types'
import type { IssueSyncLog, SyncLogType, SyncLogStatus } from '../../../src/shared/types'

/**
 * Data-access layer for the `issue_sync_logs` table.
 *
 * Audit trail for sync operations. Used by SyncLogPanel UI.
 */
export class SyncLogStore {
  constructor(private readonly db: Kysely<Database>) {}

  /** Create a new sync log entry (status: 'running'). */
  async create(log: IssueSyncLog): Promise<void> {
    await this.db
      .insertInto('issue_sync_logs')
      .values(logToRow(log))
      .execute()
  }

  /** Update an existing sync log (e.g., mark completed/failed). */
  async update(id: string, patch: Partial<IssueSyncLog>): Promise<void> {
    const setClauses = patchToRow(patch)
    if (Object.keys(setClauses).length === 0) return

    await this.db
      .updateTable('issue_sync_logs')
      .set(setClauses)
      .where('id', '=', id)
      .execute()
  }

  /** List recent sync logs for a provider (most recent first). */
  async list(providerId: string, limit = 20): Promise<IssueSyncLog[]> {
    const rows = await this.db
      .selectFrom('issue_sync_logs')
      .selectAll()
      .where('provider_id', '=', providerId)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map(rowToLog)
  }

  /** Get the most recent log for a provider. */
  async getLatest(providerId: string): Promise<IssueSyncLog | null> {
    const row = await this.db
      .selectFrom('issue_sync_logs')
      .selectAll()
      .where('provider_id', '=', providerId)
      .orderBy('started_at', 'desc')
      .limit(1)
      .executeTakeFirst()

    return row ? rowToLog(row) : null
  }

  /** Delete old logs (keep N most recent per provider). */
  async pruneOld(providerId: string, keepCount = 50): Promise<number> {
    // Find the cutoff started_at
    const rows = await this.db
      .selectFrom('issue_sync_logs')
      .select('started_at')
      .where('provider_id', '=', providerId)
      .orderBy('started_at', 'desc')
      .limit(keepCount)
      .execute()

    if (rows.length < keepCount) return 0

    const cutoff = rows[rows.length - 1].started_at

    const result = await this.db
      .deleteFrom('issue_sync_logs')
      .where('provider_id', '=', providerId)
      .where('started_at', '<', cutoff)
      .executeTakeFirst()

    return Number(result?.numDeletedRows ?? 0n)
  }
}

// ─── Row ↔ Domain ────────────────────────────────────────────────────────

function rowToLog(row: IssueSyncLogTable): IssueSyncLog {
  return {
    id: row.id,
    providerId: row.provider_id,
    syncType: row.sync_type as SyncLogType,
    status: row.status as SyncLogStatus,
    issuesCreated: row.issues_created,
    issuesUpdated: row.issues_updated,
    issuesFailed: row.issues_failed,
    commentsSynced: row.comments_synced,
    conflicts: row.conflicts,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
  }
}

function logToRow(log: IssueSyncLog): IssueSyncLogTable {
  return {
    id: log.id,
    provider_id: log.providerId,
    sync_type: log.syncType,
    status: log.status,
    issues_created: log.issuesCreated,
    issues_updated: log.issuesUpdated,
    issues_failed: log.issuesFailed,
    comments_synced: log.commentsSynced,
    conflicts: log.conflicts,
    error_message: log.errorMessage,
    started_at: log.startedAt,
    completed_at: log.completedAt,
    duration_ms: log.durationMs,
  }
}

function patchToRow(patch: Partial<IssueSyncLog>): Partial<IssueSyncLogTable> {
  const row: Partial<IssueSyncLogTable> = {}

  if (patch.status !== undefined) row.status = patch.status
  if (patch.issuesCreated !== undefined) row.issues_created = patch.issuesCreated
  if (patch.issuesUpdated !== undefined) row.issues_updated = patch.issuesUpdated
  if (patch.issuesFailed !== undefined) row.issues_failed = patch.issuesFailed
  if (patch.commentsSynced !== undefined) row.comments_synced = patch.commentsSynced
  if (patch.conflicts !== undefined) row.conflicts = patch.conflicts
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt
  if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs

  return row
}
