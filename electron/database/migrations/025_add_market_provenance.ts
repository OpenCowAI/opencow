// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

/**
 * Migration 025: Add marketplace provenance columns to legacy `capacity_import`.
 *
 * Supports tracking where a capability was installed from (marketplace id,
 * slug, and version) so the UI can show source badges and check for updates.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Add marketplace_id column (nullable — only set for marketplace imports)
  await sql`ALTER TABLE capacity_import ADD COLUMN marketplace_id TEXT DEFAULT NULL`.execute(db)
  // Add market_slug column
  await sql`ALTER TABLE capacity_import ADD COLUMN market_slug TEXT DEFAULT NULL`.execute(db)
  // Add market_version column
  await sql`ALTER TABLE capacity_import ADD COLUMN market_version TEXT DEFAULT NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // SQLite doesn't support DROP COLUMN before 3.35 — recreate table without the columns
  await sql`
    CREATE TABLE capacity_import_backup AS
    SELECT category, name, source_path, source_origin, source_hash, imported_at
    FROM capacity_import
  `.execute(db)
  await sql`DROP TABLE capacity_import`.execute(db)
  await sql`ALTER TABLE capacity_import_backup RENAME TO capacity_import`.execute(db)
  // Recreate the unique index
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_capacity_import_pk ON capacity_import(category, name)`.execute(db)
}
