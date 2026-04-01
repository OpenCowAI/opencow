// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 047 — Create issue_sync_logs table.
 *
 * Audit trail for every sync operation (pull/push/full).
 * Used by SyncLogPanel UI and for debugging sync issues.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue_sync_logs')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('provider_id', 'text', (col) =>
      col.notNull().references('issue_providers.id').onDelete('cascade')
    )
    .addColumn('sync_type', 'text', (col) => col.notNull())
    // 'pull' | 'push' | 'full'
    .addColumn('status', 'text', (col) => col.notNull())
    // 'running' | 'success' | 'partial' | 'failed'
    .addColumn('issues_created', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('issues_updated', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('issues_failed', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('comments_synced', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('conflicts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error_message', 'text')
    .addColumn('started_at', 'integer', (col) => col.notNull())
    .addColumn('completed_at', 'integer')
    .addColumn('duration_ms', 'integer')
    .execute()

  // List sync logs for a provider, most recent first
  await db.schema
    .createIndex('idx_sync_logs_provider')
    .on('issue_sync_logs')
    .columns(['provider_id', 'started_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_sync_logs_provider').ifExists().execute()
  await db.schema.dropTable('issue_sync_logs').ifExists().execute()
}
