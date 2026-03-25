// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

/**
 * Migration 031: Rename "capacity" tables and indexes to "capability".
 *
 * This is a pure rename migration -- no columns or data are changed.
 *
 * Tables renamed:
 *   - capacity_state        -> capability_state
 *   - capacity_distribution -> capability_distribution
 *   - capacity_import       -> capability_import
 *   - capacity_version      -> capability_version
 *
 * Indexes renamed:
 *   - idx_capacity_version_lookup -> idx_capability_version_lookup
 *
 * SQLite preserves all column definitions, primary-key constraints, and
 * row data when a table is renamed via ALTER TABLE ... RENAME TO.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE capacity_state RENAME TO capability_state`.execute(db)
  await sql`ALTER TABLE capacity_distribution RENAME TO capability_distribution`.execute(db)
  await sql`ALTER TABLE capacity_import RENAME TO capability_import`.execute(db)
  await sql`ALTER TABLE capacity_version RENAME TO capability_version`.execute(db)

  // Drop old index and recreate with the new name on the renamed table
  await sql`DROP INDEX IF EXISTS idx_capacity_version_lookup`.execute(db)
  await db.schema
    .createIndex('idx_capability_version_lookup')
    .on('capability_version')
    .columns(['category', 'name', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_capability_version_lookup`.execute(db)

  await sql`ALTER TABLE capability_state RENAME TO capacity_state`.execute(db)
  await sql`ALTER TABLE capability_distribution RENAME TO capacity_distribution`.execute(db)
  await sql`ALTER TABLE capability_import RENAME TO capacity_import`.execute(db)
  await sql`ALTER TABLE capability_version RENAME TO capacity_version`.execute(db)

  await db.schema
    .createIndex('idx_capacity_version_lookup')
    .on('capacity_version')
    .columns(['category', 'name', 'created_at'])
    .execute()
}
