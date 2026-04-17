// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('session_lifecycle_operations')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('session_id', 'text', (col) => col.notNull())
    .addColumn('tool_use_id', 'text', (col) => col.notNull())
    .addColumn('operation_index', 'integer', (col) => col.notNull())
    .addColumn('entity', 'text', (col) => col.notNull())
    .addColumn('action', 'text', (col) => col.notNull())
    .addColumn('normalized_payload_json', 'text', (col) => col.notNull())
    .addColumn('summary_json', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('warnings_json', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('confirmation_mode', 'text', (col) => col.notNull())
    .addColumn('state', 'text', (col) => col.notNull())
    .addColumn('idempotency_key', 'text')
    .addColumn('result_snapshot_json', 'text')
    .addColumn('error_code', 'text')
    .addColumn('error_message', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('applied_at', 'integer')
    .execute()

  await db.schema
    .createIndex('idx_session_lifecycle_operations_session_created')
    .on('session_lifecycle_operations')
    .columns(['session_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('idx_session_lifecycle_operations_session_state')
    .on('session_lifecycle_operations')
    .columns(['session_id', 'state'])
    .execute()

  await db.schema
    .createIndex('idx_session_lifecycle_operations_tool_use')
    .on('session_lifecycle_operations')
    .columns(['session_id', 'tool_use_id'])
    .execute()

  await db.schema
    .createIndex('idx_session_lifecycle_operations_unique_tool_use_operation')
    .on('session_lifecycle_operations')
    .unique()
    .columns(['session_id', 'tool_use_id', 'operation_index'])
    .execute()

  await db.schema
    .createIndex('idx_session_lifecycle_operations_idempotency')
    .on('session_lifecycle_operations')
    .unique()
    .column('idempotency_key')
    .where('idempotency_key', 'is not', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('session_lifecycle_operations').execute()
}
