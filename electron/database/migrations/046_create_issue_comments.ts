// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

/**
 * Migration 046 — Create issue_comments table.
 *
 * Stores both remote (synced from GitHub/GitLab) and local comments.
 * Remote comments are de-duplicated via the (provider_id, remote_id) unique index.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue_comments')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('issue_id', 'text', (col) =>
      col.notNull().references('issues.id').onDelete('cascade')
    )
    .addColumn('provider_id', 'text', (col) =>
      col.references('issue_providers.id').onDelete('set null')
    )
    .addColumn('remote_id', 'text')
    // GitHub/GitLab comment ID (null for local-only comments)
    .addColumn('author_login', 'text')
    .addColumn('author_name', 'text')
    .addColumn('author_avatar', 'text')
    .addColumn('body', 'text', (col) => col.notNull())
    // Markdown (remote) or TipTap JSON (local)
    .addColumn('body_format', 'text', (col) => col.notNull().defaultTo('markdown'))
    // 'markdown' | 'tiptap'
    .addColumn('is_local', 'integer', (col) => col.notNull().defaultTo(0))
    // 1 = user-created locally, 0 = synced from remote
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addColumn('synced_at', 'integer')
    .execute()

  // List comments for an issue, ordered by creation time
  await db.schema
    .createIndex('idx_comments_issue')
    .on('issue_comments')
    .columns(['issue_id', 'created_at'])
    .execute()

  // De-duplicate remote comments: one row per (provider, remote_id) pair.
  // Partial unique index — only applies when remote_id is NOT NULL.
  // Kysely doesn't support WHERE on createIndex, so we use raw SQL.
  await sql`CREATE UNIQUE INDEX idx_comments_remote ON issue_comments(provider_id, remote_id) WHERE remote_id IS NOT NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_comments_remote').ifExists().execute()
  await db.schema.dropIndex('idx_comments_issue').ifExists().execute()
  await db.schema.dropTable('issue_comments').ifExists().execute()
}
