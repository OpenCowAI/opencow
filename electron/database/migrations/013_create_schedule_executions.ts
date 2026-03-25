// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('schedule_executions')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('schedule_id', 'text', (col) => col.notNull())
    .addColumn('pipeline_id', 'text')
    .addColumn('pipeline_step_order', 'integer')
    .addColumn('trigger_type', 'text', (col) => col.notNull())
    .addColumn('trigger_detail', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('resolved_prompt', 'text')
    .addColumn('session_id', 'text')
    .addColumn('issue_id', 'text')
    .addColumn('error', 'text')
    .addColumn('scheduled_at', 'integer', (col) => col.notNull())
    .addColumn('started_at', 'integer', (col) => col.notNull())
    .addColumn('completed_at', 'integer')
    .addColumn('duration_ms', 'integer')
    .addColumn('cost_usd', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  await db.schema
    .createIndex('idx_exec_schedule')
    .on('schedule_executions')
    .column('schedule_id')
    .execute()
  await db.schema
    .createIndex('idx_exec_status')
    .on('schedule_executions')
    .column('status')
    .execute()
  await db.schema
    .createIndex('idx_exec_started')
    .on('schedule_executions')
    .column('started_at')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('schedule_executions').execute()
}
