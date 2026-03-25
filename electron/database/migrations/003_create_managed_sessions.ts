// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('managed_sessions')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('sdk_session_id', 'text')
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('stop_reason', 'text')
    .addColumn('issue_id', 'text')
    .addColumn('project_path', 'text')
    .addColumn('model', 'text')
    .addColumn('messages', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('last_activity', 'integer', (col) => col.notNull())
    .addColumn('total_cost_usd', 'real', (col) => col.notNull().defaultTo(0))
    .addColumn('input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('output_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_input_tokens', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('activity', 'text')
    .addColumn('error', 'text')
    .execute()

  await db.schema
    .createIndex('idx_sessions_state')
    .on('managed_sessions')
    .column('state')
    .execute()

  await db.schema
    .createIndex('idx_sessions_issue_id')
    .on('managed_sessions')
    .column('issue_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('managed_sessions').execute()
}
