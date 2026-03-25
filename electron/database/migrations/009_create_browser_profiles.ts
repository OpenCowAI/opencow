// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('browser_profiles')
    .addColumn('id', 'text', (col) => col.primaryKey().notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('partition', 'text', (col) => col.notNull().unique())
    .addColumn('allowed_domains', 'text', (col) => col.notNull().defaultTo('[]'))
    .addColumn('cookie_persistence', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'integer', (col) => col.notNull())
    .addColumn('last_used_at', 'integer', (col) => col.notNull())
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('browser_profiles').execute()
}
