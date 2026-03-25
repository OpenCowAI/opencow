// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Adds an `images` column to session_notes for inline image attachments.
 *
 * Stores images as a JSON array of IssueImage[] (same format as issues.images).
 * Default value is '[]' so existing rows are valid without backfill.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('session_notes')
    .addColumn('images', 'text', (col) => col.notNull().defaultTo('[]'))
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('session_notes').dropColumn('images').execute()
}
