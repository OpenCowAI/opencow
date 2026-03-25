// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('schedule_pipelines')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('steps', 'text', (col) => col.notNull())
    .addColumn('failure_policy', 'text', (col) => col.notNull().defaultTo('stop_chain'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('project_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('schedule_pipelines').execute()
}
