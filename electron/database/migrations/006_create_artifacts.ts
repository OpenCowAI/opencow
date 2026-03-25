// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
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

  // Lookup by session
  await db.schema
    .createIndex('idx_artifacts_session_id')
    .on('artifacts')
    .column('session_id')
    .execute()

  // Lookup by issue (partial — only rows with an issue)
  await db.schema
    .createIndex('idx_artifacts_issue_id')
    .on('artifacts')
    .column('issue_id')
    .where('issue_id', 'is not', null)
    .execute()

  // Starred artifacts sorted by starred_at (partial — only starred)
  await db.schema
    .createIndex('idx_artifacts_starred')
    .on('artifacts')
    .columns(['starred', 'starred_at'])
    .where('starred', '=', 1)
    .execute()

  // Lookup by project (partial)
  await db.schema
    .createIndex('idx_artifacts_project_id')
    .on('artifacts')
    .column('project_id')
    .where('project_id', 'is not', null)
    .execute()

  // Kind filter
  await db.schema
    .createIndex('idx_artifacts_kind')
    .on('artifacts')
    .column('kind')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('artifacts').execute()
}
