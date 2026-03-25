// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('installed_packages')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('prefix', 'text', (col) => col.notNull())
    .addColumn('scope', 'text', (col) => col.notNull())
    .addColumn('project_id', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('marketplace_id', 'text', (col) => col.notNull())
    .addColumn('slug', 'text', (col) => col.notNull())
    .addColumn('version', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('repo_url', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('author', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('capabilities', 'text', (col) => col.notNull().defaultTo('{}'))
    .addColumn('content_hash', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('installed_at', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'integer', (col) => col.notNull())
    .execute()

  // Unique constraint: same prefix cannot be used twice within the same scope+project
  await db.schema
    .createIndex('idx_installed_packages_unique_prefix')
    .on('installed_packages')
    .columns(['scope', 'project_id', 'prefix'])
    .unique()
    .execute()

  // Fast lookup by slug within a scope (e.g. "is obra/superpowers already installed?")
  await db.schema
    .createIndex('idx_installed_packages_slug')
    .on('installed_packages')
    .columns(['scope', 'project_id', 'slug'])
    .execute()

  // Fast project cascade on project deletion
  await db.schema
    .createIndex('idx_installed_packages_project')
    .on('installed_packages')
    .column('project_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('installed_packages').execute()
}
