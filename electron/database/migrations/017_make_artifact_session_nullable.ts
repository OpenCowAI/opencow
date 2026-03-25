// SPDX-License-Identifier: Apache-2.0

/**
 * Migration 017: make artifacts.session_id nullable.
 *
 * Originally session_id was NOT NULL because every artifact came from a session.
 * After introducing project_file artifacts (starred directly from FileBrowser or
 * file viewers without a session context), session_id must be nullable.
 *
 * SQLite does not support ALTER COLUMN, so we recreate the table via:
 *   1. Rename existing table to _old
 *   2. Create new table with nullable session_id
 *   3. Copy all data (empty-string sentinels → NULL)
 *   4. Drop the old table
 *   5. Recreate indexes
 */
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Rename old table
  await sql`ALTER TABLE artifacts RENAME TO artifacts_old`.execute(db)

  // 2. Create new table with nullable session_id
  await db.schema
    .createTable('artifacts')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('mime_type', 'text', (col) => col.notNull())
    .addColumn('file_path', 'text')
    .addColumn('file_extension', 'text')
    .addColumn('session_id', 'text')   // ← nullable (was NOT NULL)
    .addColumn('issue_id', 'text')
    .addColumn('project_id', 'text')
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('content_hash', 'text', (col) => col.notNull())
    .addColumn('content_length', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('starred', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('starred_at', 'integer')
    .addColumn('writes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('edits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  // 3. Copy data — convert empty-string sentinel → NULL
  await sql`
    INSERT INTO artifacts
    SELECT
      id, kind, title, mime_type, file_path, file_extension,
      CASE WHEN session_id = '' THEN NULL ELSE session_id END AS session_id,
      issue_id, project_id, source, content, content_hash, content_length,
      starred, starred_at, writes, edits, created_at, updated_at
    FROM artifacts_old
  `.execute(db)

  // 4. Drop old table
  await sql`DROP TABLE artifacts_old`.execute(db)

  // 5. Recreate indexes (same as migration 006)
  await db.schema
    .createIndex('idx_artifacts_session_id')
    .on('artifacts')
    .column('session_id')
    .where('session_id', 'is not', null)
    .execute()

  await db.schema
    .createIndex('idx_artifacts_issue_id')
    .on('artifacts')
    .column('issue_id')
    .where('issue_id', 'is not', null)
    .execute()

  await db.schema
    .createIndex('idx_artifacts_starred')
    .on('artifacts')
    .columns(['starred', 'starred_at'])
    .where('starred', '=', 1)
    .execute()

  await db.schema
    .createIndex('idx_artifacts_project_id')
    .on('artifacts')
    .column('project_id')
    .where('project_id', 'is not', null)
    .execute()

  await db.schema
    .createIndex('idx_artifacts_kind')
    .on('artifacts')
    .column('kind')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Restore to NOT NULL — rows with null session_id get empty string
  await sql`ALTER TABLE artifacts RENAME TO artifacts_new`.execute(db)

  await db.schema
    .createTable('artifacts')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('mime_type', 'text', (col) => col.notNull())
    .addColumn('file_path', 'text')
    .addColumn('file_extension', 'text')
    .addColumn('session_id', 'text', (col) => col.notNull())
    .addColumn('issue_id', 'text')
    .addColumn('project_id', 'text')
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('content', 'text')
    .addColumn('content_hash', 'text', (col) => col.notNull())
    .addColumn('content_length', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('starred', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('starred_at', 'integer')
    .addColumn('writes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('edits', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await sql`
    INSERT INTO artifacts
    SELECT
      id, kind, title, mime_type, file_path, file_extension,
      COALESCE(session_id, '') AS session_id,
      issue_id, project_id, source, content, content_hash, content_length,
      starred, starred_at, writes, edits, created_at, updated_at
    FROM artifacts_new
  `.execute(db)

  await sql`DROP TABLE artifacts_new`.execute(db)
}
