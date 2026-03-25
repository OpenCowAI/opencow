// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── Source registration (identity + config) ─────────────────────
  await db.schema
    .createTable('repo_sources')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('url', 'text', (col) => col.notNull().unique())
    .addColumn('platform', 'text', (col) => col.notNull())
    .addColumn('branch', 'text')
    .addColumn('credential_key', 'text')
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  // ── Sync state (ephemeral, safe to rebuild) ─────────────────────
  await db.schema
    .createTable('repo_source_sync')
    .addColumn('source_id', 'text', (col) =>
      col.primaryKey().notNull().references('repo_sources.id').onDelete('cascade'),
    )
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('idle'))
    .addColumn('last_synced_at', 'integer')
    .addColumn('last_commit', 'text')
    .addColumn('error_message', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('repo_source_sync').execute()
  await db.schema.dropTable('repo_sources').execute()
}
