// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Adds `active_duration_ms` and `active_started_at` columns to `managed_sessions`.
 *
 * These track the cumulative time a session spends in "working" states
 * (creating / streaming / stopping), excluding idle and waiting periods.
 *
 * - `active_duration_ms`:  Accumulated active time in milliseconds.
 * - `active_started_at`:   Epoch ms when the session last entered an active
 *                          state; NULL when the session is not currently active.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite only supports adding one column per ALTER TABLE statement.
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('active_duration_ms', 'real', (col) => col.notNull().defaultTo(0))
    .execute()
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('active_started_at', 'real')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('active_duration_ms')
    .execute()
  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('active_started_at')
    .execute()
}
