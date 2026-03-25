// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('projects')
    .addColumn('pin_order', 'integer')
    .execute()

  await db.schema
    .alterTable('projects')
    .addColumn('archived_at', 'integer')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('projects').dropColumn('pin_order').execute()
  await db.schema.alterTable('projects').dropColumn('archived_at').execute()
}
