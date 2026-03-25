// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('inbox_messages')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('unread'))
    .addColumn('event_type', 'text')
    .addColumn('reminder_type', 'text')
    .addColumn('project_id', 'text')
    .addColumn('session_id', 'text')
    .addColumn('payload', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('read_at', 'integer')
    .addColumn('archived_at', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_inbox_status')
    .on('inbox_messages')
    .column('status')
    .execute()

  await db.schema
    .createIndex('idx_inbox_category')
    .on('inbox_messages')
    .column('category')
    .execute()

  await db.schema
    .createIndex('idx_inbox_created_at')
    .on('inbox_messages')
    .column('created_at')
    .execute()

  await db.schema
    .createIndex('idx_inbox_project_id')
    .on('inbox_messages')
    .column('project_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('inbox_messages').execute()
}
