// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

const LEGACY_INDEX = 'idx_session_lifecycle_operations_idempotency'
const SCOPED_INDEX = 'idx_session_lifecycle_operations_session_idempotency'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex(LEGACY_INDEX).ifExists().execute()

  await db.schema
    .createIndex(SCOPED_INDEX)
    .on('session_lifecycle_operations')
    .unique()
    .columns(['session_id', 'idempotency_key'])
    .where('idempotency_key', 'is not', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex(SCOPED_INDEX).ifExists().execute()

  await db.schema
    .createIndex(LEGACY_INDEX)
    .on('session_lifecycle_operations')
    .unique()
    .column('idempotency_key')
    .where('idempotency_key', 'is not', null)
    .execute()
}
