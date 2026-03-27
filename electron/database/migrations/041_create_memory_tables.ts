// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // ── memories ─────────────────────────────────────────────────────────
  await db.schema
    .createTable('memories')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('scope', 'text', (col) => col.notNull()) // 'user' | 'project'
    .addColumn('project_id', 'text')
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('tags', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('confidence', 'real', (col) => col.notNull().defaultTo(0.7))
    .addColumn('source', 'text', (col) => col.notNull())
    .addColumn('source_id', 'text')
    .addColumn('reasoning', 'text')
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('confirmed_by', 'text')
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('previous_id', 'text')
    .addColumn('access_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_accessed_at', 'integer')
    .addColumn('expires_at', 'integer')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema.createIndex('idx_memories_scope').on('memories').columns(['scope', 'status']).execute()
  await db.schema.createIndex('idx_memories_project').on('memories').columns(['project_id', 'status']).execute()
  await db.schema.createIndex('idx_memories_category').on('memories').column('category').execute()
  await db.schema.createIndex('idx_memories_updated').on('memories').column('updated_at').execute()

  // ── FTS5 full-text index ─────────────────────────────────────────────
  await sql`CREATE VIRTUAL TABLE memories_fts USING fts5(
    content,
    tags,
    reasoning,
    content=memories,
    content_rowid=rowid,
    tokenize='unicode61 remove_diacritics 2'
  )`.execute(db)

  // FTS sync triggers
  await sql`CREATE TRIGGER memories_fts_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, tags, reasoning)
    VALUES (new.rowid, new.content, new.tags, new.reasoning);
  END`.execute(db)

  await sql`CREATE TRIGGER memories_fts_au AFTER UPDATE OF content, tags, reasoning ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags, reasoning)
    VALUES ('delete', old.rowid, old.content, old.tags, old.reasoning);
    INSERT INTO memories_fts(rowid, content, tags, reasoning)
    VALUES (new.rowid, new.content, new.tags, new.reasoning);
  END`.execute(db)

  await sql`CREATE TRIGGER memories_fts_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, tags, reasoning)
    VALUES ('delete', old.rowid, old.content, old.tags, old.reasoning);
  END`.execute(db)

  // ── memory_history (audit trail) ────────────────────────────────────
  await db.schema
    .createTable('memory_history')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('memory_id', 'text', (col) => col.notNull())
    .addColumn('event', 'text', (col) => col.notNull())
    .addColumn('previous_content', 'text')
    .addColumn('new_content', 'text')
    .addColumn('actor', 'text', (col) => col.notNull())
    .addColumn('source', 'text')
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_memory_history_memory')
    .on('memory_history')
    .columns(['memory_id', 'created_at'])
    .execute()

  // ── memory_settings (per-project overrides) ─────────────────────────
  await db.schema
    .createTable('memory_settings')
    .addColumn('project_id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('auto_confirm', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('confirm_timeout_seconds', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('extraction_sources', 'text', (col) =>
      col.notNull().defaultTo('["session","issue","issue_session","review_session"]'),
    )
    .addColumn('max_memories', 'integer', (col) => col.notNull().defaultTo(100))
    .addColumn('auto_archive_days', 'integer', (col) => col.notNull().defaultTo(90))
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS memories_fts_ad`.execute(db)
  await sql`DROP TRIGGER IF EXISTS memories_fts_au`.execute(db)
  await sql`DROP TRIGGER IF EXISTS memories_fts_ai`.execute(db)
  await sql`DROP TABLE IF EXISTS memories_fts`.execute(db)
  await db.schema.dropTable('memory_settings').ifExists().execute()
  await db.schema.dropTable('memory_history').ifExists().execute()
  await db.schema.dropTable('memories').ifExists().execute()
}
