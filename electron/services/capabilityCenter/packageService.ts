// SPDX-License-Identifier: Apache-2.0

/**
 * PackageService — orchestrates the full package lifecycle.
 *
 * Coordinates PackageStore (filesystem) + PackageRegistry (DB) + DataBus (events)
 * to provide install, uninstall, query, integrity verification, and
 * project-deletion cascade.
 *
 * This is the SINGLE AUTHORITY for package operations. All callers (IPC handlers,
 * MarketplaceService, CapabilityCenter) go through this service.
 *
 * Consistency model:
 *   Install operations use a staging → rename → DB write pattern. Per-prefix
 *   serialization prevents concurrent operations on the same package from
 *   interleaving. If the DB write fails after the FS rename succeeds, the
 *   rename is rolled back so FS and DB stay consistent. Startup reconciliation
 *   heals any remaining FS↔DB drift (e.g. process crash between rename and DB write).
 *
 * Architecture:
 *   PackageService (this file)
 *     ├── PackageStore       — filesystem operations (copy, remove, read manifest)
 *     ├── PackageRegistry    — DB CRUD (installed_packages table)
 *     └── DataBus            — event broadcasting
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { DataBus } from '../../core/dataBus'
import type { ManagedCapabilityCategory, MarketplaceId } from '@shared/types'
import { PackageStore, type PackageManifest, type PackageTarget } from './packageStore'
import { PackageRegistry, type InstalledPackageRecord, type PackageQuery } from './packageRegistry'
import type { CapabilityMount } from './capabilityStore'
import { createLogger } from '../../platform/logger'

const log = createLogger('PackageService')

/**
 * Grace period for orphan DB record cleanup during startup reconciliation.
 * Records younger than this threshold are skipped — they might belong to
 * an install that crashed between FS rename and DB write. Startup reconcile
 * will clean them up on the next launch if the FS directory is truly gone.
 */
const RECONCILE_GRACE_PERIOD_MS = 60_000

// ─── Config ──────────────────────────────────────────────────────────────

export interface PackageServiceConfig {
  packageStore: PackageStore
  packageRegistry: PackageRegistry
  dataBus?: DataBus
  resolveProjectPath: (projectId: string) => Promise<string | null>
}

// ─── Structured Params ───────────────────────────────────────────────────

export interface PackageInstallParams {
  prefix: string
  repoDir: string
  source: Omit<PackageManifest['source'], 'installedAt'>
  capabilities: PackageManifest['capabilities']
  target: PackageInstallTarget
}

export interface PackageInstallTarget {
  scope: 'global' | 'project'
  projectId?: string
}

export interface PackageUninstallParams {
  prefix: string
  scope: 'global' | 'project'
  projectId?: string
}

export interface ResolveInstallPathParams {
  scope: 'global' | 'project'
  projectId?: string
  prefix?: string
}

// ─── Results ─────────────────────────────────────────────────────────────

export interface PackageIntegrityResult {
  prefix: string
  status: 'ok' | 'corrupted' | 'missing'
  expectedHash: string
  actualHash: string
}

// ─── PackageService ──────────────────────────────────────────────────────

export class PackageService {
  private readonly store: PackageStore
  private readonly registry: PackageRegistry
  private readonly dataBus?: DataBus
  private readonly resolveProjectPathFn: (projectId: string) => Promise<string | null>

  /**
   * Per-prefix serialization lock.
   *
   * Ensures only one install/uninstall operation runs at a time for a given
   * `{scope}:{prefix}` key. Prevents interleaving of FS rename + DB write
   * when multiple callers (e.g. retry after error) target the same package.
   *
   * Entries are auto-removed when the last queued operation completes.
   */
  private readonly prefixLocks = new Map<string, Promise<void>>()

  constructor(config: PackageServiceConfig) {
    this.store = config.packageStore
    this.registry = config.packageRegistry
    this.dataBus = config.dataBus
    this.resolveProjectPathFn = config.resolveProjectPath
  }

  // ── Install ────────────────────────────────────────────────────────

  /**
   * Install a package with staging → rename → DB write pattern.
   *
   * Operations on the same prefix are serialized via per-prefix lock.
   * If the DB write fails after the FS rename, the rename is rolled back.
   *
   * Flow:
   *   1. Acquire per-prefix lock
   *   2. Resolve target path (global or project)
   *   3. Copy to staging directory (.staging-{uuid})
   *   4. Write manifest to staging
   *   5. Move existing package to trash (.trash-{uuid}) if upgrading
   *   6. Rename staging → final (atomic on same filesystem)
   *   7. Update manifest prefix + compute content hash
   *   8. Write DB record (rollback FS on failure)
   *   9. Broadcast change event
   *  10. Cleanup trash in background
   */
  async install(params: PackageInstallParams): Promise<InstalledPackageRecord> {
    const { prefix, target } = params
    const lockKey = `${target.scope}:${target.projectId ?? ''}:${prefix}`
    return this.withPrefixLock(lockKey, () => this.installInner(params))
  }

  private async installInner(params: PackageInstallParams): Promise<InstalledPackageRecord> {
    const { prefix, repoDir, source, capabilities, target } = params
    const pkgTarget = await this.resolveTarget(target)
    const packagesRoot = this.store.resolvePackagesRoot(pkgTarget)

    await fs.mkdir(packagesRoot, { recursive: true })

    const stagingName = `.staging-${randomUUID().slice(0, 8)}`
    const stagingDir = path.join(packagesRoot, stagingName)
    const finalDir = path.join(packagesRoot, prefix)

    try {
      // Phase 1: Build in staging directory
      await this.store.copyPackage({
        destName: stagingName,
        repoDir,
        source,
        capabilities,
        target: pkgTarget,
      })

      // Phase 2: Swap — move existing to trash, then staging to final
      const trashName = `.trash-${randomUUID().slice(0, 8)}`
      const trashDir = path.join(packagesRoot, trashName)
      let hasExisting = false

      try {
        await fs.access(finalDir)
        hasExisting = true
        await fs.rename(finalDir, trashDir)
      } catch {
        // No existing package — fine
      }

      await fs.rename(stagingDir, finalDir)

      // Phase 3: Update manifest prefix (staging used a temp name)
      const manifest = await this.store.readManifestFrom(packagesRoot, prefix)
      if (manifest && manifest.prefix !== prefix) {
        const manifestPath = path.join(finalDir, 'package.json')
        manifest.prefix = prefix
        manifest.name = source.slug.split('/').pop() ?? prefix
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
      }

      // Phase 4: Compute content hash + write DB record
      const contentHash = await computeDirectoryHash(finalDir)
      const now = Date.now()
      const existingRecord = await this.registry.findByPrefix(prefix, {
        scope: target.scope,
        projectId: target.scope === 'project' ? target.projectId : undefined,
      })

      const record: InstalledPackageRecord = {
        id: existingRecord?.id ?? randomUUID(),
        prefix,
        scope: target.scope,
        projectId: target.scope === 'project' && target.projectId ? target.projectId : '',
        marketplaceId: source.marketplaceId as MarketplaceId,
        slug: source.slug,
        version: source.version ?? '',
        repoUrl: source.repoUrl ?? '',
        author: source.author ?? '',
        capabilities,
        contentHash,
        installedAt: existingRecord?.installedAt ?? now,
        updatedAt: now,
      }

      // DB write with FS rollback on failure (C1 fix)
      try {
        await this.registry.register(record)
      } catch (dbErr) {
        log.error(`DB write failed for "${prefix}" — rolling back FS rename`, dbErr)
        // Rollback: move final back to staging, restore trash if present
        try {
          await fs.rename(finalDir, stagingDir)
          if (hasExisting) {
            await fs.rename(trashDir, finalDir)
          }
        } catch (rollbackErr) {
          log.error(
            `FS rollback also failed for "${prefix}". ` +
            `Startup reconcile will heal this drift.`,
            rollbackErr,
          )
        }
        throw dbErr
      }

      log.info(
        `Package "${prefix}" installed (${target.scope}) from ${source.slug}, ` +
        `hash=${contentHash.slice(0, 12)}`,
      )

      // Phase 5: Cleanup trash (non-blocking)
      if (hasExisting) {
        fs.rm(trashDir, { recursive: true, force: true }).catch((err) => {
          log.warn(`Failed to cleanup trash ${trashDir}:`, err)
        })
      }

      this.notifyChange({ type: 'package:installed', prefix, scope: target.scope })
      return record
    } catch (err) {
      // Cleanup staging on failure (may already be renamed away — that's fine)
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  // ── Uninstall ──────────────────────────────────────────────────────

  async uninstall(params: PackageUninstallParams): Promise<boolean> {
    const lockKey = `${params.scope}:${params.projectId ?? ''}:${params.prefix}`
    return this.withPrefixLock(lockKey, async () => {
      const pkgTarget = await this.resolveTarget(params)
      const removed = await this.store.removePackage(params.prefix, pkgTarget)
      if (removed) {
        await this.registry.unregisterByPrefix(params.prefix, {
          scope: params.scope,
          projectId: params.projectId,
        })
        this.notifyChange({ type: 'package:uninstalled', prefix: params.prefix, scope: params.scope })
        log.info(`Package "${params.prefix}" uninstalled (${params.scope})`)
      }
      return removed
    })
  }

  // ── Query ──────────────────────────────────────────────────────────

  async list(query: PackageQuery): Promise<InstalledPackageRecord[]> {
    return this.registry.list(query)
  }

  async getByPrefix(prefix: string, query: PackageQuery): Promise<InstalledPackageRecord | null> {
    return this.registry.findByPrefix(prefix, query)
  }

  async getBySlug(slug: string, query: PackageQuery): Promise<InstalledPackageRecord | null> {
    return this.registry.findBySlug(slug, query)
  }

  async prefixExists(prefix: string, query: PackageQuery): Promise<boolean> {
    const record = await this.registry.findByPrefix(prefix, query)
    return record !== null
  }

  // ── Install Path Resolution ────────────────────────────────────────

  async resolveInstallPath(params: ResolveInstallPathParams): Promise<string> {
    const pkgTarget = await this.resolveTarget(params)
    const root = this.store.resolvePackagesRoot(pkgTarget)
    return params.prefix ? path.join(root, params.prefix) : root
  }

  // ── Mount Providers (for CapabilityStore integration) ──────────────

  async getGlobalMounts(): Promise<CapabilityMount[]> {
    return this.store.getGlobalPackageMounts()
  }

  async getProjectMounts(projectPath: string): Promise<CapabilityMount[]> {
    return this.store.getProjectPackageMounts(projectPath)
  }

  getGlobalPackagesRoot(): string {
    return this.store.getGlobalPackagesRoot()
  }

  // ── Integrity Verification ─────────────────────────────────────────

  async verify(prefix: string, query: PackageQuery): Promise<PackageIntegrityResult> {
    const record = await this.registry.findByPrefix(prefix, query)
    if (!record) {
      return { prefix, status: 'missing', expectedHash: '', actualHash: '' }
    }

    const pkgTarget = await this.resolveTarget({
      scope: record.scope,
      projectId: record.projectId || undefined,
    })
    const packagesRoot = this.store.resolvePackagesRoot(pkgTarget)
    const packageDir = path.join(packagesRoot, prefix)

    try {
      await fs.access(packageDir)
    } catch {
      return { prefix, status: 'missing', expectedHash: record.contentHash, actualHash: '' }
    }

    const actualHash = await computeDirectoryHash(packageDir)
    return {
      prefix,
      status: actualHash === record.contentHash ? 'ok' : 'corrupted',
      expectedHash: record.contentHash,
      actualHash,
    }
  }

  // ── Project Deletion Cascade ───────────────────────────────────────

  /**
   * Clean up all package state for a deleted project.
   *
   * Order: FS first, then DB. This prevents startupReconcile from
   * ghost-backfilling DB records from directories that are about to be deleted.
   *
   * Note: This is NOT transactional — if the process crashes between FS delete
   * and DB delete, orphan DB records will persist until next startup reconcile
   * cleans them up (which is acceptable: they reference a deleted project and
   * have no directory on disk, so reconcile will garbage-collect them).
   */
  async onProjectDeleted(projectId: string, projectPath?: string): Promise<void> {
    // Phase 1: Remove filesystem first (prevents reconcile backfill race)
    if (projectPath) {
      const pkgTarget: PackageTarget = { scope: 'project', projectPath }
      try {
        const packagesRoot = this.store.resolvePackagesRoot(pkgTarget)
        await fs.rm(packagesRoot, { recursive: true, force: true })
        log.info(`Removed project packages dir: ${packagesRoot}`)
      } catch (err) {
        log.warn(`Failed to remove project packages dir for ${projectId}:`, err)
      }
    }

    // Phase 2: Clean up DB records
    const count = await this.registry.deleteByProjectId(projectId)
    if (count > 0) {
      log.info(`Cleaned up ${count} package DB record(s) for deleted project ${projectId}`)
    }

    this.notifyChange()
  }

  // ── Startup Recovery ───────────────────────────────────────────────

  /**
   * Run on startup to reconcile filesystem and DB state:
   *
   * 1. Clean up leftover staging/trash directories (interrupted installs)
   * 2. Backfill DB records for packages that exist on disk but not in DB
   * 3. Remove DB records for packages that no longer exist on disk
   *    (skips records younger than RECONCILE_GRACE_PERIOD_MS to avoid
   *    deleting records for in-flight installs)
   */
  async startupReconcile(): Promise<void> {
    const globalRoot = this.store.getGlobalPackagesRoot()
    await this.reconcileDirectory(globalRoot, 'global', '')
  }

  private async reconcileDirectory(
    packagesRoot: string,
    scope: 'global' | 'project',
    projectId: string,
  ): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(packagesRoot, { withFileTypes: true }) as unknown as import('node:fs').Dirent[]
    } catch {
      return // Directory doesn't exist — nothing to reconcile
    }

    // Phase 1: Clean up staging/trash leftovers
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.staging-') || entry.name.startsWith('.trash-')) {
        const dir = path.join(packagesRoot, entry.name)
        log.info(`Startup cleanup: removing leftover "${entry.name}"`)
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      }
    }

    // Phase 2: Backfill — packages on disk without DB record
    const dbPackages = await this.registry.list({ scope, projectId: projectId || undefined })
    const dbPrefixes = new Set(dbPackages.map((p) => p.prefix))

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (dbPrefixes.has(entry.name)) continue

      const manifest = await this.store.readManifestFrom(packagesRoot, entry.name)
      if (!manifest) continue

      const packageDir = path.join(packagesRoot, entry.name)
      const contentHash = await computeDirectoryHash(packageDir)
      const now = Date.now()

      const record: InstalledPackageRecord = {
        id: randomUUID(),
        prefix: manifest.prefix,
        scope,
        projectId,
        marketplaceId: manifest.source.marketplaceId as MarketplaceId,
        slug: manifest.source.slug,
        version: manifest.source.version ?? '',
        repoUrl: manifest.source.repoUrl ?? '',
        author: manifest.source.author ?? '',
        capabilities: manifest.capabilities,
        contentHash,
        installedAt: manifest.source.installedAt
          ? new Date(manifest.source.installedAt).getTime()
          : now,
        updatedAt: now,
      }

      await this.registry.register(record)
      log.info(`Backfilled DB record for package "${entry.name}" (${scope})`)
    }

    // Phase 3: Orphan cleanup — DB records without directories on disk.
    // Skip records younger than RECONCILE_GRACE_PERIOD_MS — they may belong
    // to an install that crashed between FS rename and DB write. The next
    // startup will clean them if the directory is truly gone.
    const now = Date.now()
    for (const dbPkg of dbPackages) {
      const dir = path.join(packagesRoot, dbPkg.prefix)
      try {
        await fs.access(dir)
      } catch {
        const age = now - dbPkg.updatedAt
        if (age < RECONCILE_GRACE_PERIOD_MS) {
          log.info(
            `Skipping recent orphan DB record for "${dbPkg.prefix}" (${scope}, ` +
            `age=${Math.round(age / 1000)}s < ${RECONCILE_GRACE_PERIOD_MS / 1000}s grace period)`,
          )
          continue
        }
        await this.registry.unregister(dbPkg.id)
        log.info(`Removed orphan DB record for package "${dbPkg.prefix}" (${scope})`)
      }
    }
  }

  // ── Internal ───────────────────────────────────────────────────────

  /**
   * Serialize async operations on the same prefix.
   *
   * Implements a promise-chain mutex: each new call awaits the previous
   * one for the same key, ensuring sequential execution without blocking
   * other prefixes.
   */
  private async withPrefixLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.prefixLocks.get(key) ?? Promise.resolve()
    let releaseFn: () => void
    const gate = new Promise<void>((resolve) => { releaseFn = resolve })
    this.prefixLocks.set(key, gate)

    // Wait for previous operation to finish (ignore its errors — they were handled)
    await prev.catch(() => {})

    try {
      return await fn()
    } finally {
      // Clean up if no one queued after us
      if (this.prefixLocks.get(key) === gate) {
        this.prefixLocks.delete(key)
      }
      releaseFn!()
    }
  }

  private async resolveTarget(
    params: { scope: 'global' | 'project'; projectId?: string },
  ): Promise<PackageTarget> {
    if (params.scope === 'project') {
      if (!params.projectId) {
        throw new Error(
          'PackageService: scope is "project" but projectId is missing. ' +
          'Ensure a project is selected before performing project-scoped operations.',
        )
      }
      const projectPath = await this.resolveProjectPathFn(params.projectId)
      if (!projectPath) {
        throw new Error(`PackageService: project not found: ${params.projectId}`)
      }
      return { scope: 'project', projectPath }
    }
    return { scope: 'global' }
  }

  private notifyChange(
    event?: { type: 'package:installed' | 'package:uninstalled'; prefix: string; scope: string },
  ): void {
    if (!this.dataBus) return
    // Always broadcast capabilities:changed for CapabilityCenter cache invalidation
    this.dataBus.dispatch({ type: 'capabilities:changed', payload: {} })
    // Also broadcast the specific package event if provided
    if (event) {
      this.dataBus.dispatch({
        type: event.type,
        payload: { prefix: event.prefix, scope: event.scope },
      })
    }
  }
}

// ─── Content Hashing ─────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash of a package directory's contents.
 *
 * Hashes file paths (relative, sorted) + file contents to detect any changes.
 * Deterministic: same contents always produce the same hash.
 */
async function computeDirectoryHash(dir: string): Promise<string> {
  const hash = createHash('sha256')
  const files = await collectFiles(dir)

  // Sort for determinism
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  for (const file of files) {
    // Null-byte separators prevent collision when filename suffix + file
    // content prefix accidentally align (e.g. "a" + "bc" vs "ab" + "c").
    hash.update(file.relativePath)
    hash.update('\0')
    const content = await fs.readFile(file.absolutePath)
    hash.update(content)
    hash.update('\0')
  }

  return hash.digest('hex')
}

interface FileEntry {
  relativePath: string
  absolutePath: string
}

async function collectFiles(dir: string, base?: string): Promise<FileEntry[]> {
  const entries: FileEntry[] = []
  const baseDir = base ?? dir

  let dirEntries: import('node:fs').Dirent[]
  try {
    dirEntries = await fs.readdir(dir, { withFileTypes: true }) as unknown as import('node:fs').Dirent[]
  } catch {
    return entries
  }

  for (const entry of dirEntries) {
    const absolutePath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      entries.push(...await collectFiles(absolutePath, baseDir))
    } else if (entry.isFile()) {
      entries.push({
        relativePath: path.relative(baseDir, absolutePath),
        absolutePath,
      })
    }
  }

  return entries
}
