// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue_views')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('icon', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('filters', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('display', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('position', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_issue_views_position')
    .on('issue_views')
    .column('position')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('issue_views').execute()
}
