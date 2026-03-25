// SPDX-License-Identifier: Apache-2.0

/**
 * OpenCow data directory brand migration module.
 *
 * ## Atomicity guarantee
 * Uses a temp directory + rename strategy:
 *   1. cp legacyDir -> tempDir (interruptible; tempDir clearly marks "incomplete")
 *   2. Execute fileRenames (rename files inside tempDir)
 *   3. rename tempDir -> targetDir (atomic operation, same filesystem)
 *   4. rename legacyDir -> backup (preserve historical backup)
 *
 * If the process is killed between steps 1-2: next startup detects tempDir exists -> clean up -> retry.
 *
 * ## Idempotency
 * - Source directory missing -> skip (skipped_source_missing)
 * - Target directory exists -> skip (skipped_target_exists)
 * - Temp directory exists but target doesn't -> clean temp directory then retry
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { cp, rename, rm, mkdir, writeFile } from 'fs/promises'
import { createLogger } from './logger'

const log = createLogger('DataMigration')

// ─── Type Definitions ────────────────────────────────────────────────────────

export interface DataMigrationOptions {
  /** Legacy data directory name (with dot prefix), e.g. '.ccboard' */
  readonly legacyDirName: string
  /** Target data directory name (with dot prefix), e.g. '.opencow' */
  readonly targetDirName: string
  /**
   * List of file renames inside the directory (paths relative to root).
   * Executed after copy completes and before the atomic rename.
   */
  readonly fileRenames?: ReadonlyArray<{
    readonly from: string  // e.g. 'db/ccboard.db'
    readonly to: string    // e.g. 'db/app.db'
  }>
  /** Dry run: log only, do not perform file operations (for testing) @default false */
  readonly dryRun?: boolean
}

export type MigrationVariantStatus =
  | 'migrated'
  | 'skipped_source_missing'
  | 'skipped_target_exists'
  | 'dry_run'

export interface DataMigrationResult {
  readonly variants: ReadonlyArray<{
    readonly legacyDir: string
    readonly targetDir: string
    readonly status: MigrationVariantStatus
  }>
  /** Whether any variant was actually migrated (not skipped) */
  readonly didMigrate: boolean
}

// ─── Migration Logic ─────────────────────────────────────────────────────────

/**
 * Execute data directory brand migration (atomic, idempotent).
 *
 * Processes both the production directory (`.opencow`) and development directory (`.opencow-dev`).
 */
export async function migrateDataDirectory(
  options: DataMigrationOptions,
): Promise<DataMigrationResult> {
  const { legacyDirName, targetDirName, fileRenames = [], dryRun = false } = options
  const home = homedir()
  const variants = [
    { suffix: '', label: 'production' },
    { suffix: '-dev', label: 'development' },
  ]

  const results: DataMigrationResult['variants'][number][] = []
  let didMigrate = false

  for (const { suffix, label } of variants) {
    const legacyDir = join(home, `${legacyDirName}${suffix}`)
    const targetDir = join(home, `${targetDirName}${suffix}`)
    const tempDir = join(home, `${targetDirName}${suffix}-tmp`)

    if (!existsSync(legacyDir)) {
      log.debug(`[${label}] Source missing, skip: ${legacyDir}`)
      results.push({ legacyDir, targetDir, status: 'skipped_source_missing' })
      continue
    }

    // Check whether the target directory already contains a database file (not just an
    // empty shell created by Logger or other initialization code).
    // Logger runs before migration and creates targetDir/logs/, so targetDir may exist without actual data.
    const targetDbPath = join(targetDir, 'db', 'app.db')
    if (existsSync(targetDir) && existsSync(targetDbPath)) {
      log.info(`[${label}] Target exists with database, skip: ${targetDir}`)
      results.push({ legacyDir, targetDir, status: 'skipped_target_exists' })
      continue
    }

    // Target directory exists but has no database (empty shell created by Logger, etc.) -> clean up then continue migration
    if (existsSync(targetDir)) {
      log.info(`[${label}] Target exists but no database — removing empty shell: ${targetDir}`)
      await rm(targetDir, { recursive: true, force: true })
    }

    if (dryRun) {
      log.info(`[DRY RUN][${label}] Would migrate: ${legacyDir} → ${targetDir}`)
      results.push({ legacyDir, targetDir, status: 'dry_run' })
      continue
    }

    // Clean up stale temp directory from a previous interrupted run (idempotent)
    if (existsSync(tempDir)) {
      log.warn(`[${label}] Stale temp dir detected, cleaning: ${tempDir}`)
      await rm(tempDir, { recursive: true, force: true })
    }

    log.info(`[${label}] Migrating: ${legacyDir} → ${targetDir}`)

    try {
      // Step 1: Copy to temp directory
      await cp(legacyDir, tempDir, { recursive: true, preserveTimestamps: true })

      // Step 2: Rename files inside the directory (within tempDir, does not affect original data)
      for (const { from, to } of fileRenames) {
        const fromPath = join(tempDir, from)
        const toPath = join(tempDir, to)
        if (existsSync(fromPath)) {
          await mkdir(join(toPath, '..'), { recursive: true })
          await rename(fromPath, toPath)
          log.info(`[${label}] File renamed: ${from} → ${to}`)
        }
      }

      // Step 3: Atomic rename tempDir -> targetDir (same filesystem, POSIX guarantees atomicity)
      await rename(tempDir, targetDir)

      // Step 4: Back up old directory (non-atomic, but targetDir is already safe at this point — no data loss)
      const backupDir = `${legacyDir}-migrated-${Date.now()}`
      await rename(legacyDir, backupDir)

      // Step 5: Write migration marker file (for notifying the user later)
      const markerPath = join(targetDir, '.migrated-from-legacy')
      await writeFile(markerPath, JSON.stringify({
        migratedAt: new Date().toISOString(),
        legacyDir,
        backupDir,
      }, null, 2))

      log.info(`[${label}] Migration complete. Backup: ${backupDir}`)
      results.push({ legacyDir, targetDir, status: 'migrated' })
      didMigrate = true
    } catch (err) {
      // Clean up tempDir to prevent leftover dirty data from affecting next startup
      if (existsSync(tempDir)) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
      log.error(`[${label}] Migration failed`, err)
      throw new Error(`Data migration failed (${legacyDir} → ${targetDir}): ${String(err)}`, { cause: err })
    }
  }

  return { variants: results, didMigrate }
}
