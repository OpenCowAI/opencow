// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'

/**
 * Migration 022: Create initial Capability Center tables (legacy `capacity_*` names).
 *
 * Four tables for the Capability Center subsystem:
 *   - capacity_state:        toggle / tags / sort metadata per capability
 *   - capacity_distribution: tracks what has been published to Claude Code CLI
 *   - capacity_import:       tracks what has been imported from external sources
 *   - capacity_version:      content version history (used by M6)
 *
 * Design decisions (v3.1):
 *   - project_path uses '' (empty string) instead of NULL for global scope,
 *     enabling a clean composite PRIMARY KEY without COALESCE expressions.
 *   - No DEFAULT expressions using unixepoch(); timestamps are set at the
 *     application layer via Date.now() for cross-platform compatibility.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ── capacity_state ──────────────────────────────────────────
  await db.schema
    .createTable('capacity_state')
    .addColumn('scope', 'text', (col) =>
      col.notNull().check(sql`scope IN ('global', 'project')`),
    )
    .addColumn('project_path', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('enabled', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('tags', 'text', (col) => col.defaultTo('[]'))
    .addColumn('sort_order', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_capacity_state', [
      'scope',
      'project_path',
      'category',
      'name',
    ])
    .execute()

  // ── capacity_distribution ───────────────────────────────────
  await db.schema
    .createTable('capacity_distribution')
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('target_type', 'text', (col) => col.notNull())
    .addColumn('target_path', 'text', (col) => col.notNull())
    .addColumn('strategy', 'text', (col) => col.notNull().defaultTo('copy'))
    .addColumn('content_hash', 'text', (col) => col.notNull())
    .addColumn('distributed_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_capacity_distribution', [
      'category',
      'name',
      'target_type',
    ])
    .execute()

  // ── capacity_import ─────────────────────────────────────────
  await db.schema
    .createTable('capacity_import')
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('source_path', 'text', (col) => col.notNull())
    .addColumn('source_origin', 'text', (col) => col.notNull())
    .addColumn('source_hash', 'text')
    .addColumn('imported_at', 'integer', (col) => col.notNull())
    .addPrimaryKeyConstraint('pk_capacity_import', ['category', 'name'])
    .execute()

  // ── capacity_version (used by M6) ──────────────────────────
  await db.schema
    .createTable('capacity_version')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('category', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('content_hash', 'text', (col) => col.notNull())
    .addColumn('snapshot', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_capacity_version_lookup')
    .on('capacity_version')
    .columns(['category', 'name', 'created_at'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('capacity_version').ifExists().execute()
  await db.schema.dropTable('capacity_import').ifExists().execute()
  await db.schema.dropTable('capacity_distribution').ifExists().execute()
  await db.schema.dropTable('capacity_state').ifExists().execute()
}
