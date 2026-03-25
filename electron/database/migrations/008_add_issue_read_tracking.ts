// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Adds read-tracking columns to the issues table for unread indicators.
 *
 * - `read_at`:                 Timestamp of when the user last viewed the issue.
 * - `last_agent_activity_at`:  Timestamp of when the agent last completed work
 *                              on this issue (session idle / stopped).
 *
 * An issue is "unread" when:
 *   last_agent_activity_at IS NOT NULL
 *   AND (read_at IS NULL OR last_agent_activity_at > read_at)
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('issues')
    .addColumn('read_at', 'integer')
    .execute()

  await db.schema
    .alterTable('issues')
    .addColumn('last_agent_activity_at', 'integer')
    .execute()

  // Mark all existing issues as "read" so users don't see a flood of
  // unread indicators after upgrading.  last_agent_activity_at stays NULL
  // — existing issues have no tracked agent activity, so they won't show
  // as unread.
  await sql`UPDATE issues SET read_at = updated_at`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // SQLite doesn't support DROP COLUMN in older versions, but Kysely's
  // alterTable().dropColumn() uses the modern ALTER TABLE DROP COLUMN
  // syntax available since SQLite 3.35.0 (2021-03-12).
  await db.schema.alterTable('issues').dropColumn('read_at').execute()
  await db.schema.alterTable('issues').dropColumn('last_agent_activity_at').execute()
}
