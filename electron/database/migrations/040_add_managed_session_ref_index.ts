// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 040 — Index managed session engine refs for fast Hook-event resolution.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createIndex('idx_managed_sessions_sdk_session_id')
    .on('managed_sessions')
    .column('sdk_session_id')
    .where('sdk_session_id', 'is not', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_managed_sessions_sdk_session_id')
    .ifExists()
    .execute()
}
