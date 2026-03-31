// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 044 — Extend issues table for remote issue tracking.
 *
 * Adds columns to link local issues with their remote counterparts
 * (GitHub/GitLab) via the issue_providers table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Add remote-tracking columns to the issues table
  await db.schema
    .alterTable('issues')
    .addColumn('provider_id', 'text', (col) =>
      col.references('issue_providers.id').onDelete('set null')
    )
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('remote_number', 'integer')
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('remote_url', 'text')
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('remote_state', 'text')
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('remote_synced_at', 'integer')
    .execute()

  // Unique index: one local issue per remote issue number per provider
  await db.schema
    .createIndex('idx_issues_provider_remote_number')
    .on('issues')
    .columns(['provider_id', 'remote_number'])
    .unique()
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_issues_provider_remote_number')
    .ifExists()
    .execute()

  // SQLite doesn't support DROP COLUMN directly in older versions,
  // but Kysely handles this via table recreation when needed.
  await db.schema.alterTable('issues').dropColumn('remote_synced_at').execute()
  await db.schema.alterTable('issues').dropColumn('remote_state').execute()
  await db.schema.alterTable('issues').dropColumn('remote_url').execute()
  await db.schema.alterTable('issues').dropColumn('remote_number').execute()
  await db.schema.alterTable('issues').dropColumn('provider_id').execute()
}
