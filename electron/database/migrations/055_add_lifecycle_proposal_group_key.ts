// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const LEGACY_UNIQUE_TUPLE_INDEX = 'idx_session_lifecycle_operations_unique_tool_use_operation'
const LEGACY_TOOL_USE_INDEX = 'idx_session_lifecycle_operations_tool_use'
const NEXT_GROUP_INDEX = 'idx_session_lifecycle_operations_group'
const NEXT_UNIQUE_TUPLE_INDEX = 'idx_session_lifecycle_operations_unique_group_operation'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('session_lifecycle_operations')
    .addColumn('proposal_group_key', 'text', (col) => col.notNull().defaultTo(''))
    .execute()

  await sql`
    UPDATE session_lifecycle_operations
    SET proposal_group_key = tool_use_id
    WHERE proposal_group_key IS NULL OR proposal_group_key = ''
  `.execute(db)

  await db.schema.dropIndex(LEGACY_UNIQUE_TUPLE_INDEX).ifExists().execute()
  await db.schema.dropIndex(LEGACY_TOOL_USE_INDEX).ifExists().execute()

  await db.schema
    .createIndex(NEXT_GROUP_INDEX)
    .on('session_lifecycle_operations')
    .columns(['session_id', 'proposal_group_key'])
    .execute()

  await db.schema
    .createIndex(NEXT_UNIQUE_TUPLE_INDEX)
    .on('session_lifecycle_operations')
    .unique()
    .columns(['session_id', 'proposal_group_key', 'operation_index'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex(NEXT_UNIQUE_TUPLE_INDEX).ifExists().execute()
  await db.schema.dropIndex(NEXT_GROUP_INDEX).ifExists().execute()

  await db.schema
    .createIndex(LEGACY_TOOL_USE_INDEX)
    .on('session_lifecycle_operations')
    .columns(['session_id', 'tool_use_id'])
    .execute()

  await db.schema
    .createIndex(LEGACY_UNIQUE_TUPLE_INDEX)
    .on('session_lifecycle_operations')
    .unique()
    .columns(['session_id', 'tool_use_id', 'operation_index'])
    .execute()

  await db.schema
    .alterTable('session_lifecycle_operations')
    .dropColumn('proposal_group_key')
    .execute()
}
