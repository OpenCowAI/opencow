// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import { sql, type Kysely } from 'kysely'

/**
 * Migration 024: Normalize legacy capability table paths to a portable format.
 *
 * Replaces absolute home directory prefix (e.g. `/Users/alice`) with `~`
 * in legacy table columns `capacity_distribution.target_path` and
 * `capacity_import.source_path`.
 *
 * This makes the database portable across machines / usernames.
 * At runtime, the StateRepository row mappers expand `~` back to `os.homedir()`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const homeDir = os.homedir()
  const homeDirPrefix = `${homeDir}%`
  const tildeToken = '~'
  // SQLite substr() is 1-based; skip the home directory prefix
  const substringStart = homeDir.length + 1

  // Normalize capacity_distribution.target_path
  await sql`
    UPDATE capacity_distribution
    SET target_path = ${tildeToken} || substr(target_path, ${substringStart})
    WHERE target_path LIKE ${homeDirPrefix}
  `.execute(db)

  // Normalize capacity_import.source_path
  await sql`
    UPDATE capacity_import
    SET source_path = ${tildeToken} || substr(source_path, ${substringStart})
    WHERE source_path LIKE ${homeDirPrefix}
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const homeDir = os.homedir()
  const tildePrefix = '~%'

  // Expand capacity_distribution.target_path
  await sql`
    UPDATE capacity_distribution
    SET target_path = ${homeDir} || substr(target_path, 2)
    WHERE target_path LIKE ${tildePrefix}
  `.execute(db)

  // Expand capacity_import.source_path
  await sql`
    UPDATE capacity_import
    SET source_path = ${homeDir} || substr(source_path, 2)
    WHERE source_path LIKE ${tildePrefix}
  `.execute(db)
}
