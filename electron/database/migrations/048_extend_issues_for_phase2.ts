// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 048 — Extend issues table for Phase 2 bidirectional sync.
 *
 * Adds:
 * - assignees: JSON array of {login, name, avatarUrl} objects
 * - milestone: JSON object {id, title, dueDate}
 * - sync_status: tracks local↔remote divergence state
 * - remote_updated_at: remote issue's updated_at timestamp (for conflict detection)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite requires one ALTER TABLE per addColumn
  await db.schema
    .alterTable('issues')
    .addColumn('assignees', 'text')
    // JSON: [{"login":"octocat","name":"The Octocat","avatarUrl":"https://..."}]
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('milestone', 'text')
    // JSON: {"id":1,"title":"v1.0","dueDate":"2026-06-01"}
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('sync_status', 'text')
    // 'synced' | 'local_ahead' | 'conflict' | NULL (local-only)
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('remote_updated_at', 'integer')
    // Epoch ms of remote issue's updated_at — used for conflict detection
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issues').dropColumn('remote_updated_at').execute()
  await db.schema.alterTable('issues').dropColumn('sync_status').execute()
  await db.schema.alterTable('issues').dropColumn('milestone').execute()
  await db.schema.alterTable('issues').dropColumn('assignees').execute()
}
