// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('projects')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('canonical_path', 'text', (col) => col.notNull())
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('project_claude_mappings')
    .addColumn('claude_folder_id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('project_id', 'text', (col) =>
      col.notNull().references('projects.id').onDelete('cascade')
    )
    .addColumn('discovered_at', 'integer', (col) => col.notNull())
    .execute()

  await db.schema
    .createIndex('idx_pcm_project')
    .on('project_claude_mappings')
    .column('project_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('project_claude_mappings').execute()
  await db.schema.dropTable('projects').execute()
}
