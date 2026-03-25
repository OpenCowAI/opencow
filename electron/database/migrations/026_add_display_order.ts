// SPDX-License-Identifier: Apache-2.0

import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('projects')
    .addColumn('display_order', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()

  // Initialize display_order for non-pinned, non-archived projects
  // using alphabetical order by name (case-insensitive).
  await sql`
    UPDATE projects SET display_order = (
      SELECT COUNT(*) FROM projects p2
      WHERE p2.pin_order IS NULL
        AND p2.archived_at IS NULL
        AND p2.name < projects.name
    )
    WHERE pin_order IS NULL AND archived_at IS NULL
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('projects').dropColumn('display_order').execute()
}
