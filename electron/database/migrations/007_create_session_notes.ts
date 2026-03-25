// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('session_notes')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('issue_id', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('source_file_path', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_session_notes_issue')
    .on('session_notes')
    .column('issue_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('session_notes').execute()
}
