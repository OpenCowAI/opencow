// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Adds a `queued_messages` column to managed_sessions for persisting
 * the user's message queue across page refreshes.
 *
 * Queue data is stored as a JSON string (QueuedMessageRecord[]).
 * NULL when no messages are queued — the default state.
 *
 * Only text and slash_command blocks are persisted; binary blobs
 * (image/document base64) are intentionally excluded to keep the
 * column size bounded.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('queued_messages', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('queued_messages')
    .execute()
}
