// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Migration 037 — Create project_external_mappings.
 *
 * Purpose:
 * - Keep legacy `project_claude_mappings` untouched
 * - Introduce engine-agnostic external project reference mapping
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project_external_mappings')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('project_id', 'text', (col) =>
      col.notNull().references('projects.id').onDelete('cascade')
    )
    .addColumn('engine_kind', 'text', (col) => col.notNull())
    .addColumn('external_project_ref', 'text', (col) => col.notNull())
    .addColumn('discovered_at', 'integer', (col) => col.notNull())
    .addUniqueConstraint('uq_project_external_mapping_ref', ['engine_kind', 'external_project_ref'])
    .execute()

  await db.schema
    .createIndex('idx_project_external_mappings_project_id')
    .on('project_external_mappings')
    .column('project_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .dropIndex('idx_project_external_mappings_project_id')
    .ifExists()
    .execute()

  await db.schema
    .dropTable('project_external_mappings')
    .ifExists()
    .execute()
}

