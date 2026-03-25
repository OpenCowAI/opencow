// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

/**
 * Migration 016: Drop orphaned issue_id column from managed_sessions
 *
 * Context
 * ───────
 * Migration 003 created managed_sessions with an `issue_id TEXT` column
 * and a corresponding index `idx_sessions_issue_id`.
 *
 * Migration 015 introduced the two-column `origin_source` / `origin_id`
 * model to replace `issue_id`, migrated all existing data, and left the
 * old column in place "for one release to allow rollback."
 *
 * As of migration 016, the `issue_id` column is completely dead:
 *   • No application code reads or writes it.
 *   • New rows have issue_id = NULL (no write path exists).
 *   • The TypeScript type ManagedSessionTable no longer declares it.
 *   • Its index `idx_sessions_issue_id` is never used by any query.
 *
 * Strategy: Table reconstruction
 * ───────────────────────────────
 * SQLite's ALTER TABLE supports DROP COLUMN only from v3.35.0 (2021-03-12).
 * Rather than rely on the SQLite version bundled with the host Electron build,
 * we use the universally-supported table-reconstruction pattern:
 *
 *   1. Create a new table with the clean schema.
 *   2. Copy all rows from the old table (SELECT only the columns we want).
 *   3. Drop the old table (and its indexes with it).
 *   4. Rename the new table.
 *   5. Recreate all required indexes.
 *
 * This approach is safe, version-agnostic, and idempotent when wrapped
 * inside the Kysely migration framework.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // SQLite requires disabling foreign-key checks during table reconstruction.
  await sql`PRAGMA foreign_keys = OFF`.execute(db)

  try {
    // 1. Create replacement table with clean schema (no issue_id column)
    await sql`
      CREATE TABLE managed_sessions_new (
        id                TEXT    PRIMARY KEY NOT NULL,
        sdk_session_id    TEXT,
        state             TEXT    NOT NULL,
        stop_reason       TEXT,
        origin_source     TEXT    NOT NULL DEFAULT 'agent',
        origin_id         TEXT,
        project_path      TEXT,
        model             TEXT,
        messages          TEXT    NOT NULL DEFAULT '[]',
        created_at        INTEGER NOT NULL,
        last_activity     INTEGER NOT NULL,
        total_cost_usd    REAL    NOT NULL DEFAULT 0,
        input_tokens      INTEGER NOT NULL DEFAULT 0,
        output_tokens     INTEGER NOT NULL DEFAULT 0,
        last_input_tokens INTEGER NOT NULL DEFAULT 0,
        activity          TEXT,
        error             TEXT
      )
    `.execute(db)

    // 2. Copy all rows, excluding issue_id
    await sql`
      INSERT INTO managed_sessions_new (
        id, sdk_session_id, state, stop_reason,
        origin_source, origin_id,
        project_path, model, messages,
        created_at, last_activity,
        total_cost_usd, input_tokens, output_tokens, last_input_tokens,
        activity, error
      )
      SELECT
        id, sdk_session_id, state, stop_reason,
        origin_source, origin_id,
        project_path, model, messages,
        created_at, last_activity,
        total_cost_usd, input_tokens, output_tokens, last_input_tokens,
        activity, error
      FROM managed_sessions
    `.execute(db)

    // 3. Drop the old table (this also removes idx_sessions_issue_id and idx_sessions_state)
    await sql`DROP TABLE managed_sessions`.execute(db)

    // 4. Rename replacement table
    await sql`ALTER TABLE managed_sessions_new RENAME TO managed_sessions`.execute(db)

    // 5. Recreate indexes (idx_sessions_issue_id is intentionally NOT recreated)
    await sql`
      CREATE INDEX idx_sessions_state ON managed_sessions (state)
    `.execute(db)

    await sql`
      CREATE INDEX idx_sessions_origin_source ON managed_sessions (origin_source)
    `.execute(db)
  } finally {
    await sql`PRAGMA foreign_keys = ON`.execute(db)
  }
}

/**
 * Rolling back migration 016 means restoring the issue_id column.
 * Since issue_id data was preserved up through migration 015's data migration
 * (origin_id contains the old issueId for 'issue'-sourced sessions),
 * a true rollback is impractical and not worth engineering.
 *
 * If a rollback to before migration 015 is ever needed, restore from backup.
 */
export async function down(_db: Kysely<unknown>): Promise<void> {
  // Intentionally a no-op: restoring issue_id from origin_id is non-trivial
  // and rolling back past migration 015 requires a database backup.
  throw new Error(
    'Migration 016 down() is not supported. Restore from a database backup to roll back past this migration.',
  )
}
