// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from 'kysely'
import type { Database, IssueChangeQueueTable } from '../../database/types'
import type { ChangeQueueEntry, ChangeQueueOperation, ChangeQueueStatus } from '../../../src/shared/types'

/**
 * Data-access layer for the `issue_change_queue` table.
 *
 * Manages the offline-first async push queue. All queue merge strategies
 * are enforced in the service layer, not here.
 */
export class ChangeQueueStore {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Run a callback inside a DB transaction, passing a transactional
   * ChangeQueueStore so all reads/writes within are atomic.
   */
  async withTransaction<T>(fn: (txStore: ChangeQueueStore) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const txStore = new ChangeQueueStore(trx as unknown as Kysely<Database>)
      return fn(txStore)
    })
  }

  /** Insert a new entry at the end of the queue. */
  async enqueue(entry: ChangeQueueEntry): Promise<void> {
    await this.db
      .insertInto('issue_change_queue')
      .values(entryToRow(entry))
      .execute()
  }

  /** Fetch the next N pending entries, ordered by creation time (FIFO). */
  async dequeuePending(limit = 10): Promise<ChangeQueueEntry[]> {
    const rows = await this.db
      .selectFrom('issue_change_queue')
      .selectAll()
      .where('status', '=', 'pending')
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute()

    return rows.map(rowToEntry)
  }

  /**
   * Atomically claim the next N pending entries by setting status='processing'
   * in a single UPDATE+SELECT transaction. Prevents duplicate claims when
   * multiple processQueue() calls overlap.
   *
   * Uses a subquery: UPDATE WHERE id IN (SELECT id ... WHERE status='pending' LIMIT N)
   * then SELECTs the claimed rows. SQLite's serialized writes guarantee atomicity.
   */
  async claimPending(limit = 10): Promise<ChangeQueueEntry[]> {
    return await this.db.transaction().execute(async (trx) => {
      // Only claim entries that are ready for processing:
      // - First attempt (retry_count = 0): always ready
      // - Retries: only if enough time has passed since the last attempt (exponential backoff)
      //   Backoff formula: min(5000 * 2^retry_count, 300000) ms
      // This avoids the busy-loop of claiming → checking → releasing unready entries.
      const now = Date.now()
      const pendingIds = await trx
        .selectFrom('issue_change_queue')
        .select('id')
        .where('status', '=', 'pending')
        .where((eb) => eb.or([
          eb('retry_count', '=', 0),
          eb(sql`COALESCE(processed_at, created_at) + MIN(5000 * POWER(2, retry_count), 300000)`, '<=', now),
        ]))
        .orderBy('created_at', 'asc')
        .limit(limit)
        .execute()

      if (pendingIds.length === 0) return []

      const ids = pendingIds.map((r) => r.id)

      // Atomically mark as processing
      await trx
        .updateTable('issue_change_queue')
        .set({ status: 'processing' })
        .where('id', 'in', ids)
        .execute()

      // Return the claimed entries
      const rows = await trx
        .selectFrom('issue_change_queue')
        .selectAll()
        .where('id', 'in', ids)
        .orderBy('created_at', 'asc')
        .execute()

      return rows.map(rowToEntry)
    })
  }

  /** Get all pending entries for a specific issue (used for merge strategies). */
  async getPendingForIssue(localIssueId: string): Promise<ChangeQueueEntry[]> {
    const rows = await this.db
      .selectFrom('issue_change_queue')
      .selectAll()
      .where('local_issue_id', '=', localIssueId)
      .where('status', '=', 'pending')
      .orderBy('created_at', 'asc')
      .execute()

    return rows.map(rowToEntry)
  }

  /** Mark an entry as processing (claimed by PushEngine). */
  async markProcessing(id: string): Promise<void> {
    await this.db
      .updateTable('issue_change_queue')
      .set({ status: 'processing' })
      .where('id', '=', id)
      .execute()
  }

  /** Release a claimed entry back to pending (e.g. not ready for retry yet). */
  async releaseToPending(id: string): Promise<void> {
    await this.db
      .updateTable('issue_change_queue')
      .set({ status: 'pending' })
      .where('id', '=', id)
      .execute()
  }

  /** Mark an entry as completed. */
  async markCompleted(id: string): Promise<void> {
    await this.db
      .updateTable('issue_change_queue')
      .set({ status: 'completed', processed_at: Date.now() })
      .where('id', '=', id)
      .execute()
  }

  /**
   * Mark an entry as failed, atomically incrementing retry count.
   * Uses a single UPDATE with SQL expressions to avoid race conditions.
   * If retry_count + 1 >= max_retries, status is set to 'failed'; otherwise 'pending' (for retry).
   *
   * @param forceFail When true, immediately set status to 'failed' regardless of retry count.
   *   Used for permanent errors (401, 404, etc.) that should not be retried.
   */
  async markFailed(id: string, errorMessage: string, forceFail = false): Promise<void> {
    await this.db
      .updateTable('issue_change_queue')
      .set({
        retry_count: sql`retry_count + 1`,
        status: forceFail
          ? sql`'failed'`
          : sql`CASE WHEN retry_count + 1 >= max_retries THEN 'failed' ELSE 'pending' END`,
        error_message: errorMessage,
        processed_at: Date.now(),
      } as any)
      .where('id', '=', id)
      .execute()
  }

  /** Update the payload of a pending entry (used by merge strategies). */
  async updatePayload(id: string, payload: string): Promise<void> {
    await this.db
      .updateTable('issue_change_queue')
      .set({ payload })
      .where('id', '=', id)
      .execute()
  }

  /** Delete entries by ID (used for queue cancellation in merge strategies). */
  async deleteEntries(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db
      .deleteFrom('issue_change_queue')
      .where('id', 'in', ids)
      .execute()
  }

  /** Delete all completed entries (housekeeping). */
  async purgeCompleted(): Promise<number> {
    const result = await this.db
      .deleteFrom('issue_change_queue')
      .where('status', '=', 'completed')
      .executeTakeFirst()

    return Number(result?.numDeletedRows ?? 0n)
  }

  /** Get counts by status for a provider (used by UI sync status indicators). */
  async countByStatus(providerId: string): Promise<Record<ChangeQueueStatus, number>> {
    const rows = await this.db
      .selectFrom('issue_change_queue')
      .select(['status'])
      .select((eb) => eb.fn.count('id').as('count'))
      .where('provider_id', '=', providerId)
      .groupBy('status')
      .execute()

    const counts: Record<ChangeQueueStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    }
    for (const row of rows) {
      const status = row.status as ChangeQueueStatus
      if (status in counts) counts[status] = Number(row.count)
    }
    return counts
  }
}

// ─── Row ↔ Domain ────────────────────────────────────────────────────────

function rowToEntry(row: IssueChangeQueueTable): ChangeQueueEntry {
  return {
    id: row.id,
    localIssueId: row.local_issue_id,
    providerId: row.provider_id,
    operation: row.operation as ChangeQueueOperation,
    payload: row.payload,
    status: row.status as ChangeQueueStatus,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  }
}

function entryToRow(entry: ChangeQueueEntry): IssueChangeQueueTable {
  return {
    id: entry.id,
    local_issue_id: entry.localIssueId,
    provider_id: entry.providerId,
    operation: entry.operation,
    payload: entry.payload,
    status: entry.status,
    retry_count: entry.retryCount,
    max_retries: entry.maxRetries,
    error_message: entry.errorMessage,
    created_at: entry.createdAt,
    processed_at: entry.processedAt,
  }
}
