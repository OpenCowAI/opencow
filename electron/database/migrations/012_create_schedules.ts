// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('schedules')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('trigger_config', 'text', (col) => col.notNull())
    .addColumn('action_config', 'text', (col) => col.notNull())
    .addColumn('priority', 'text', (col) => col.notNull().defaultTo('normal'))
    .addColumn('failure_policy', 'text', (col) => col.notNull())
    .addColumn('missed_policy', 'text', (col) => col.notNull().defaultTo('skip'))
    .addColumn('concurrency_policy', 'text', (col) => col.notNull().defaultTo('skip'))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('next_run_at', 'integer')
    .addColumn('last_run_at', 'integer')
    .addColumn('last_run_status', 'text')
    .addColumn('last_run_error', 'text')
    .addColumn('start_date', 'integer')
    .addColumn('end_date', 'integer')
    .addColumn('max_executions', 'integer')
    .addColumn('execution_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('consecutive_failures', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('project_id', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('idx_schedules_status').on('schedules').column('status').execute()
  await db.schema
    .createIndex('idx_schedules_next_run')
    .on('schedules')
    .column('next_run_at')
    .execute()
  await db.schema
    .createIndex('idx_schedules_project')
    .on('schedules')
    .column('project_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('schedules').execute()
}
