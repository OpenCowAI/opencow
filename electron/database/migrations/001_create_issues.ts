// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issues')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('backlog'))
    .addColumn('priority', 'text', (col) => col.notNull().defaultTo('medium'))
    .addColumn('labels', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('project_id', 'text')
    .addColumn('session_id', 'text')
    .addColumn('session_history', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('parent_issue_id', 'text')
    .addColumn('images', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_issues_status')
    .on('issues')
    .column('status')
    .execute()

  await db.schema
    .createIndex('idx_issues_priority')
    .on('issues')
    .column('priority')
    .execute()

  await db.schema
    .createIndex('idx_issues_project_id')
    .on('issues')
    .column('project_id')
    .execute()

  await db.schema
    .createIndex('idx_issues_parent')
    .on('issues')
    .column('parent_issue_id')
    .execute()

  // Custom labels — standalone table (not per-issue junction)
  await db.schema
    .createTable('custom_labels')
    .addColumn('label', 'text', (col) => col.primaryKey().notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('custom_labels').execute()
  await db.schema.dropTable('issues').execute()
}
