// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'

/**
 * Adds a `rich_content` column to issues for lossless TipTap JSON storage.
 *
 * Issues now support slash commands via a TipTap rich-text editor. The existing
 * `description` column continues to hold plain text (used for search, list
 * preview, and MCP API responses). `rich_content` stores the TipTap document
 * JSON so slash mention nodes survive round-trips without attribute loss.
 *
 * NULL for issues created before this migration (plain-text only).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('issues')
    .addColumn('rich_content', 'text')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('issues').dropColumn('rich_content').execute()
}
