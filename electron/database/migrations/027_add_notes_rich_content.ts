// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Adds a `rich_content` column to session_notes for lossless TipTap JSON storage.
 *
 * Notes now support slash commands via a TipTap rich-text editor. The existing
 * `content` column continues to hold plain text (used for display, search, and
 * backward-compatible send-to-chat). `rich_content` stores the TipTap document
 * JSON so slash mention nodes survive round-trips without attribute loss.
 *
 * NULL for notes created before this migration (plain-text only).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('session_notes')
    .addColumn('rich_content', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('session_notes').dropColumn('rich_content').execute()
}
