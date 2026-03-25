// SPDX-License-Identifier: Apache-2.0

import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect, Migrator } from 'kysely'
import { migrationProvider } from './migrations/provider'
import { createLogger } from '../platform/logger'
import type { Database } from './types'

const log = createLogger('db')

export interface DatabaseService {
  /** Type-safe query builder */
  readonly db: Kysely<Database>
  /** Raw better-sqlite3 handle (for PRAGMA, backup, etc.) */
  readonly raw: BetterSqlite3.Database
  /** Gracefully close the database connection */
  close(): Promise<void>
}

/**
 * Initialise the SQLite database at `dbPath`, apply PRAGMA tuning,
 * and run pending migrations.
 *
 * better-sqlite3 is synchronous, so the returned Promises resolve
 * in the same tick — but we keep the async API for Kysely compat.
 */
export async function initDatabase(dbPath: string): Promise<DatabaseService> {
  const raw = new BetterSqlite3(dbPath)

  // Performance & safety PRAGMAs
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = NORMAL')
  raw.pragma('foreign_keys = ON')
  raw.pragma('busy_timeout = 5000')
  raw.pragma('cache_size = -20000') // 20 MB

  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: raw }),
  })

  // Run pending migrations
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error, results } = await migrator.migrateToLatest()

  results?.forEach((r) => {
    if (r.status === 'Success') {
      log.info('Migration applied', r.migrationName)
    }
    if (r.status === 'Error') {
      log.error('Migration failed', r.migrationName)
    }
  })

  if (error) {
    // Ensure the raw connection is closed on migration failure
    raw.close()
    throw error
  }

  return {
    db,
    raw,
    close: () => db.destroy(),
  }
}
