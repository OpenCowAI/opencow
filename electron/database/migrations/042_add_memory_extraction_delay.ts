// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('memory_settings')
    .addColumn('extraction_delay_seconds', 'integer', (col) => col.notNull().defaultTo(15))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('memory_settings')
    .dropColumn('extraction_delay_seconds')
    .execute()
}
