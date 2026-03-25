// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Drops the `queued_messages` column from `managed_sessions`.
 *
 * Queue persistence was moved from SQLite to renderer-side localStorage,
 * making this column obsolete. See migration 029 for original addition.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('queued_messages')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('queued_messages', 'text')
    .execute()
}
