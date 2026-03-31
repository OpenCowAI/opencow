// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 043 — Create issue_providers table.
 *
 * Stores GitHub/GitLab integration configurations per project.
 * Each row represents one remote repo connection for issue syncing.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue_providers')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('project_id', 'text', (col) =>
      col.notNull().references('projects.id').onDelete('cascade')
    )
    .addColumn('platform', 'text', (col) => col.notNull()) // 'github' | 'gitlab'
    .addColumn('repo_owner', 'text', (col) => col.notNull())
    .addColumn('repo_name', 'text', (col) => col.notNull())
    .addColumn('api_base_url', 'text') // custom for GitLab self-hosted
    .addColumn('auth_token_ref', 'text', (col) => col.notNull()) // keychain key or encrypted ciphertext
    .addColumn('auth_storage', 'text', (col) => col.notNull().defaultTo('keychain')) // 'keychain' | 'encrypted'
    .addColumn('sync_enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('sync_interval_s', 'integer', (col) => col.notNull().defaultTo(300))
    .addColumn('last_synced_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addUniqueConstraint('uq_issue_provider_repo', [
      'project_id',
      'platform',
      'repo_owner',
      'repo_name',
    ])
    .execute()

  await db.schema
    .createIndex('idx_issue_providers_project_id')
    .on('issue_providers')
    .column('project_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_issue_providers_project_id')
    .ifExists()
    .execute()

  await db.schema
    .dropTable('issue_providers')
    .ifExists()
    .execute()
}
