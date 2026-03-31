// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 045 — Create issue_change_queue table.
 *
 * Offline-first async push queue for bidirectional issue sync.
 * Each row represents a pending local change to be pushed to GitHub/GitLab.
 *
 * Queue merge strategies are enforced at enqueue time (application layer),
 * not via DB triggers.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue_change_queue')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('local_issue_id', 'text', (col) =>
      col.notNull().references('issues.id').onDelete('cascade')
    )
    .addColumn('provider_id', 'text', (col) =>
      col.notNull().references('issue_providers.id').onDelete('cascade')
    )
    .addColumn('operation', 'text', (col) => col.notNull())
    // 'create' | 'update' | 'close' | 'reopen' | 'comment'
    .addColumn('payload', 'text', (col) => col.notNull())
    // JSON: full field snapshot for idempotent replay
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    // 'pending' | 'processing' | 'completed' | 'failed'
    .addColumn('retry_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('max_retries', 'integer', (col) => col.notNull().defaultTo(5))
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('processed_at', 'integer')
    .execute()

  // Fast lookup for queue processing: pending items ordered by creation time
  await db.schema
    .createIndex('idx_change_queue_status')
    .on('issue_change_queue')
    .columns(['status', 'created_at'])
    .execute()

  // Fast lookup for merge strategies: find existing entries for an issue
  await db.schema
    .createIndex('idx_change_queue_issue')
    .on('issue_change_queue')
    .column('local_issue_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_change_queue_issue').ifExists().execute()
  await db.schema.dropIndex('idx_change_queue_status').ifExists().execute()
  await db.schema.dropTable('issue_change_queue').ifExists().execute()
}
