// SPDX-License-Identifier: Apache-2.0

/**
 * StartupMigrations — one-time data migrations that run during app bootstrap.
 *
 * Migrations are split into two phases:
 *   1. **Pre-database** — runs before SQLite is opened (directory renames, hook rewrites)
 *   2. **Post-database** — runs after all services are initialised (legacy ID rewrites,
 *      preferences.json → projects table)
 *
 * Each migration is idempotent — safe to run on every startup, but designed to
 * no-op quickly when the migration has already been applied.
 *
 * This module exists to keep main.ts focused on orchestration and to make
 * migration logic independently testable.
 */

import { join } from 'path'
import { readFile, unlink } from 'fs/promises'
import { migrateDataDirectory } from '../platform/dataMigration'
import { installHooks, removeLegacyHookEntries } from '../services/hooksInstaller'
import { ProjectIdMigrator } from '../services/projectIdMigrator'
import { ProjectStore } from '../services/projectStore'
import { createLogger } from '../platform/logger'
import type { DataPaths } from '../platform/dataPaths'
import type { DatabaseService } from '../database/db'
import type { ProjectService } from '../services/projectService'

const log = createLogger('Migrations')

// ── Types ────────────────────────────────────────────────────────────────────

export interface PreDatabaseMigrationConfig {
  /** Legacy directory name to migrate from (e.g. '.ccboard'). */
  legacyDirName: string
  /** Target directory name (e.g. '.opencow'). */
  targetDirName: string
  /** Data paths resolved for the current platform. */
  dataPaths: DataPaths
  /** Hook environment for reinstallation after brand migration. */
  hookEnv: 'production' | 'development'
}

export interface PostDatabaseMigrationConfig {
  database: DatabaseService
  projectService: ProjectService
  dataPaths: DataPaths
}

// ── Pre-database migrations ──────────────────────────────────────────────────

/**
 * Run migrations that must complete before the database is opened.
 *
 * Phase -1: Migrate legacy data directory (.ccboard → .opencow)
 * Phase -0.5: Rewrite hook marker entries after brand migration
 */
export async function runPreDatabaseMigrations(config: PreDatabaseMigrationConfig): Promise<void> {
  const { legacyDirName, targetDirName, dataPaths, hookEnv } = config

  // Phase -1: Data directory migration (atomic and idempotent)
  const migrationResult = await migrateDataDirectory({
    legacyDirName,
    targetDirName,
    fileRenames: [
      { from: 'db/ccboard.db', to: 'db/app.db' },  // Decouple DB filename from brand name
    ],
  }).catch((err) => {
    log.error('Data migration failed — blocking startup to prevent empty DB overwrite', err)
    throw err
  })

  // Phase -0.5: Hook marker migration
  if (migrationResult.didMigrate) {
    await removeLegacyHookEntries('__ccboard__')
    await installHooks(dataPaths, hookEnv)
    log.info('Brand migration complete: data directory migrated, hooks reinstalled')
  }
}

// ── Post-database migrations ─────────────────────────────────────────────────

/**
 * Run migrations that depend on the database and service layer.
 *
 * Phase 2.5: Rewrite legacy project IDs (folder-based → UUID)
 * Phase 2.6: Migrate preferences.json into the projects table
 *
 * All migrations are best-effort — failures are logged but never block startup.
 */
export async function runPostDatabaseMigrations(config: PostDatabaseMigrationConfig): Promise<void> {
  const { database, projectService, dataPaths } = config

  await migrateProjectIds(database)
  await migratePreferencesJson(projectService, dataPaths)
}

/**
 * Phase 2.5: One-time migration of legacy folder-based project IDs to UUIDs.
 */
async function migrateProjectIds(database: DatabaseService): Promise<void> {
  try {
    const idMigrator = new ProjectIdMigrator({
      db: database.db,
      projectStore: new ProjectStore(database.db),
    })

    const result = await idMigrator.migrateDatabase()
    if (result.issues + result.inbox > 0) {
      log.info('Migrated legacy project IDs', { issues: result.issues, inbox: result.inbox })
    }
  } catch (err) {
    log.error('Legacy project ID migration failed', err)
  }
}

/**
 * Phase 2.6: Migrate pinned/archived project preferences from JSON file
 * into the projects database table, then delete the JSON file.
 */
async function migratePreferencesJson(
  projectService: ProjectService,
  dataPaths: DataPaths,
): Promise<void> {
  const prefsJsonPath = join(dataPaths.root, 'preferences.json')

  try {
    const raw = await readFile(prefsJsonPath, 'utf-8')
    const prefs = JSON.parse(raw) as {
      pinnedProjectIds?: string[]
      archivedProjectIds?: string[]
    }

    if (Array.isArray(prefs.pinnedProjectIds)) {
      for (let i = 0; i < prefs.pinnedProjectIds.length; i++) {
        await projectService.pinProjectAtOrder(prefs.pinnedProjectIds[i], i)
      }
    }
    if (Array.isArray(prefs.archivedProjectIds)) {
      for (const id of prefs.archivedProjectIds) {
        await projectService.archiveProject(id)
      }
    }

    await unlink(prefsJsonPath)
    log.info('Migrated preferences.json into projects table')
  } catch {
    // File doesn't exist or already migrated — skip silently
  }
}
