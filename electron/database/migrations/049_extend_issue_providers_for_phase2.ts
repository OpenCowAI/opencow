// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 049 — Extend issue_providers table for Phase 2 bidirectional sync.
 *
 * Adds:
 * - sync_direction: controls whether sync is readonly, push-only, or bidirectional
 * - sync_cursor: opaque cursor for incremental sync (ISO 8601 timestamp or page token)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('issue_providers')
    .addColumn('sync_direction', 'text', (col) => col.notNull().defaultTo('readonly'))
    // 'readonly' | 'push' | 'bidirectional'
    .execute()

  await db.schema
    .alterTable('issue_providers')
    .addColumn('sync_cursor', 'text')
    // Opaque cursor for incremental sync (ISO 8601 or page token)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issue_providers').dropColumn('sync_cursor').execute()
  await db.schema.alterTable('issue_providers').dropColumn('sync_direction').execute()
}
