// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration 017 — Add origin_extra column to managed_sessions.
 *
 * Background
 * ----------
 * Migration 015 introduced (origin_source, origin_id) to encode SessionOrigin.
 * For 'telegram' sessions origin_id stored botId — sufficient for single-chat bots.
 *
 * The telegram origin now carries TWO routing dimensions:
 *   - chatId  (which Telegram chat initiated the session → reply target)
 *   - botId   (which bot instance handles it → multi-bot support)
 *
 * Encoding them both in a single `origin_id` TEXT column isn't viable without
 * composite-string hacks. origin_extra is the natural second-slot column.
 *
 * New semantics for 'telegram' sessions:
 *   origin_source = 'telegram'
 *   origin_id     = chatId   ← primary filter / reply-routing key
 *   origin_extra  = botId    ← secondary filter for multi-bot support
 *
 * All other origin types leave origin_extra = NULL.
 *
 * Existing telegram rows
 * ----------------------
 * Before this migration, telegram rows had origin_id = botId.
 * The UPDATE below copies the old botId into origin_extra (so the field is
 * non-null for existing rows), while origin_id now represents chatId.
 * Existing rows are effectively orphaned (their "chatId" is the old botId
 * which will never match a real chat), so they won't be resumed — correct
 * behaviour since they predate the routing fix.
 *
 * Rollback: not supported (down() throws).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ALTER TABLE ADD COLUMN is supported in SQLite; no reconstruction needed.
  await sql`ALTER TABLE managed_sessions ADD COLUMN origin_extra TEXT`.execute(db)

  // For existing telegram rows: copy the old botId (stored in origin_id) into
  // origin_extra so the botId field is preserved after schema interpretation changes.
  await sql`
    UPDATE managed_sessions
    SET origin_extra = origin_id
    WHERE origin_source = 'telegram'
  `.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // SQLite does not support DROP COLUMN without full table reconstruction.
  // Rollback is deliberately not implemented — origin_extra is additive and
  // leaves the pre-017 schema intact for all non-telegram rows.
  throw new Error(
    'Migration 017 down() is not supported. ' +
    'Restore from a pre-017 database snapshot to roll back.'
  )
}
