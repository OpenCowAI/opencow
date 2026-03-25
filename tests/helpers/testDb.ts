// SPDX-License-Identifier: Apache-2.0

import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator } from 'kysely'
import { migrationProvider } from '../../electron/database/migrations/provider'
import type { Database } from '../../electron/database/types'

/**
 * Creates an in-memory SQLite database for testing.
 * Runs all migrations so the schema matches production.
 *
 * Usage:
 * ```ts
 * let db: Kysely<Database>
 * let close: () => Promise<void>
 *
 * beforeEach(async () => {
 *   ({ db, close } = await createTestDb())
 * })
 *
 * afterEach(async () => {
 *   await close()
 * })
 * ```
 */
export async function createTestDb(): Promise<{
  db: Kysely<Database>
  raw: BetterSqlite3.Database
  close: () => Promise<void>
}> {
  const raw = new BetterSqlite3(':memory:')
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')

  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: raw }),
  })

  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error) throw error

  return {
    db,
    raw,
    close: () => db.destroy(),
  }
}
