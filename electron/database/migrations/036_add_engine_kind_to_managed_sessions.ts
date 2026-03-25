// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 036 — Add engine-scoped metadata to managed_sessions.
 *
 * Non-destructive (expand-only):
 * - Adds `engine_kind` with default 'claude'
 * - Adds optional `engine_state_json` for engine-specific checkpoint/thread state
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('managed_sessions')
    .addColumn('engine_kind', 'text', (col) => col.notNull().defaultTo('claude'))
    .execute()

  await db.schema
    .alterTable('managed_sessions')
    .addColumn('engine_state_json', 'text')
    .execute()

  await db.schema
    .createIndex('idx_managed_sessions_engine_kind')
    .on('managed_sessions')
    .column('engine_kind')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_managed_sessions_engine_kind')
    .ifExists()
    .execute()

  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('engine_state_json')
    .execute()

  await db.schema
    .alterTable('managed_sessions')
    .dropColumn('engine_kind')
    .execute()
}

