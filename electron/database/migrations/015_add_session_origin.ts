// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration 015: Add session origin tracking to managed_sessions
 *
 * Replaces the flat `issue_id` column with a proper two-column origin model:
 *   origin_source  TEXT NOT NULL DEFAULT 'agent'  — SessionOrigin.source
 *   origin_id      TEXT                            — source-specific context ID
 *
 * Data migration:
 *   - Existing rows with issue_id NOT NULL → origin_source='issue', origin_id=issue_id
 *   - Existing rows with issue_id NULL     → origin_source='agent', origin_id=NULL
 *
 * The old issue_id column is intentionally kept for one release to allow
 * rollback via the down() function. It will be dropped in a future migration.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add new columns with safe defaults (SQLite requires separate ALTER TABLE per column)
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('origin_source', 'text', (col) => col.notNull().defaultTo('agent'))
    .execute()

  await db.schema
    .alterTable('managed_sessions')
    .addColumn('origin_id', 'text')
    .execute()

  // 2. Migrate existing data: rows with issue_id → source='issue'
  await sql`
    UPDATE managed_sessions
    SET origin_source = 'issue',
        origin_id     = issue_id
    WHERE issue_id IS NOT NULL
  `.execute(db)

  // 3. Index on origin_source for fast source-based filtering
  await db.schema
    .createIndex('idx_sessions_origin_source')
    .on('managed_sessions')
    .column('origin_source')
    .execute()
}

/**
 * Rolling back migration 015 in isolation is not supported.
 * Migration 016 supersedes this migration's cleanup intent, and rolling back
 * past the origin model requires a database backup.
 */
export async function down(_db: Kysely<unknown>): Promise<void> {
  throw new Error(
    'Migration 015 down() is not supported. Restore from a database backup to roll back the origin model.',
  )
}
