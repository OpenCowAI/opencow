// SPDX-License-Identifier: Apache-2.0

/**
 * State Repository — Kysely-based state persistence for Capability Center.
 *
 * Design decisions (v3.1):
 *   - Receives `Kysely<Database>` (fix #2, #8) — not raw better-sqlite3
 *   - No `migrate()` method — tables created by 022_create_capability_tables (fix #1)
 *   - All queries use Kysely type-safe API (fix #2)
 *   - `project_id` uses '' for global scope (fix #3, migrated from project_path in 023)
 *   - Timestamps from application layer Date.now() (fix #22)
 *
 * Refactoring (quality review):
 *   - All upserts use Kysely onConflict() — eliminates TOCTOU race conditions
 *   - Added batchGetImports/batchGetDistributions — eliminates N+1 queries
 *   - Domain types use ManagedCapabilityCategory instead of string where possible
 *   - Row mappers validate strategy/sourceOrigin at the boundary
 */

import os from 'node:os'
import { sql, type Kysely } from 'kysely'
import type {
  Database,
  CapabilityStateTable,
  CapabilityDistributionTable,
  CapabilityImportTable,
  CapabilityVersionTable,
} from '../../database/types'
import type { ManagedCapabilityCategory } from '@shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('StateRepository')

// ─── Constants ──────────────────────────────────────────────────────────

/** Sentinel value for global scope in project_id column (never NULL). */
const GLOBAL_SCOPE_ID = ''

/** Portable home directory token for cross-machine path portability. */
const HOME_TOKEN = '~'

const VALID_STRATEGIES = new Set(['copy', 'symlink'])
const VALID_ORIGINS = new Set(['claude-code', 'codex', 'plugin', 'marketplace', 'template', 'file', 'unknown'])
const ALL_MANAGED_CATEGORIES = ['skill', 'agent', 'command', 'rule', 'hook', 'mcp-server'] as const

// ─── Domain Types ───────────────────────────────────────────────────────

export interface CapabilityToggle {
  enabled: boolean
  tags: string[]
  sortOrder: number
}

export interface DistributionRecord {
  category: ManagedCapabilityCategory
  name: string
  targetType: string
  targetPath: string
  strategy: 'copy' | 'symlink'
  contentHash: string
  distributedAt: number
}

export interface ImportRecord {
  category: ManagedCapabilityCategory
  name: string
  sourcePath: string
  sourceOrigin: 'claude-code' | 'codex' | 'plugin' | 'marketplace' | 'template' | 'file' | 'unknown'
  sourceHash: string | null
  importedAt: number
  /** Marketplace provenance metadata (only present for marketplace imports) */
  marketplaceId?: string | null
  marketSlug?: string | null
  marketVersion?: string | null
}

export interface VersionRecord {
  id: number
  category: ManagedCapabilityCategory
  name: string
  contentHash: string
  snapshot: string
  createdAt: number
}

// ─── StateRepository ────────────────────────────────────────────────────

export class StateRepository {
  constructor(private readonly db: Kysely<Database>) {}

  // ── Toggle State ────────────────────────────────────────────────────

  async getToggle(
    scope: 'global' | 'project',
    projectId: string | undefined,
    category: ManagedCapabilityCategory,
    name: string,
  ): Promise<CapabilityToggle | null> {
    const row = await this.db
      .selectFrom('capability_state')
      .selectAll()
      .where('scope', '=', scope)
      .where('project_id', '=', resolveProjectId(projectId))
      .where('category', '=', category)
      .where('name', '=', name)
      .executeTakeFirst()

    return row ? rowToToggle(row) : null
  }

  async setToggle(
    scope: 'global' | 'project',
    projectId: string | undefined,
    category: ManagedCapabilityCategory,
    name: string,
    enabled: boolean,
  ): Promise<void> {
    const now = Date.now()
    const pp = resolveProjectId(projectId)

    await this.db
      .insertInto('capability_state')
      .values({
        scope,
        project_id: pp,
        category,
        name,
        enabled: enabled ? 1 : 0,
        tags: '[]',
        sort_order: 0,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .columns(['scope', 'project_id', 'category', 'name'])
          .doUpdateSet({ enabled: enabled ? 1 : 0, updated_at: now }),
      )
      .execute()
  }

  async setTags(
    scope: 'global' | 'project',
    projectId: string | undefined,
    category: ManagedCapabilityCategory,
    name: string,
    tags: string[],
  ): Promise<void> {
    const now = Date.now()
    const pp = resolveProjectId(projectId)

    await this.db
      .insertInto('capability_state')
      .values({
        scope,
        project_id: pp,
        category,
        name,
        enabled: 1,
        tags: JSON.stringify(tags),
        sort_order: 0,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc
          .columns(['scope', 'project_id', 'category', 'name'])
          .doUpdateSet({ tags: JSON.stringify(tags), updated_at: now }),
      )
      .execute()
  }

  async batchGetToggles(
    scope: 'global' | 'project',
    projectId: string | undefined,
    category: ManagedCapabilityCategory,
  ): Promise<Map<string, CapabilityToggle>> {
    const rows = await this.db
      .selectFrom('capability_state')
      .selectAll()
      .where('scope', '=', scope)
      .where('project_id', '=', resolveProjectId(projectId))
      .where('category', '=', category)
      .execute()

    const map = new Map<string, CapabilityToggle>()
    for (const row of rows) {
      map.set(row.name, rowToToggle(row))
    }
    return map
  }

  async removeToggle(
    scope: 'global' | 'project',
    projectId: string | undefined,
    category: ManagedCapabilityCategory,
    name: string,
  ): Promise<void> {
    await this.db
      .deleteFrom('capability_state')
      .where('scope', '=', scope)
      .where('project_id', '=', resolveProjectId(projectId))
      .where('category', '=', category)
      .where('name', '=', name)
      .execute()
  }

  // ── Distribution Tracking ─────────────────────────────────────────

  async recordDistribution(record: DistributionRecord): Promise<void> {
    const portablePath = toPortablePath(record.targetPath)

    await this.db
      .insertInto('capability_distribution')
      .values({
        category: record.category,
        name: record.name,
        target_type: record.targetType,
        target_path: portablePath,
        strategy: record.strategy,
        content_hash: record.contentHash,
        distributed_at: record.distributedAt,
      })
      .onConflict((oc) =>
        oc
          .columns(['category', 'name', 'target_type'])
          .doUpdateSet({
            target_path: portablePath,
            strategy: record.strategy,
            content_hash: record.contentHash,
            distributed_at: record.distributedAt,
          }),
      )
      .execute()
  }

  async getDistribution(
    category: ManagedCapabilityCategory,
    name: string,
    targetType: string,
  ): Promise<DistributionRecord | null> {
    const row = await this.db
      .selectFrom('capability_distribution')
      .selectAll()
      .where('category', '=', category)
      .where('name', '=', name)
      .where('target_type', '=', targetType)
      .executeTakeFirst()

    return row ? rowToDistribution(row) : null
  }

  /** Batch-get distributions for multiple names in one category. */
  async batchGetDistributions(
    category: ManagedCapabilityCategory,
    names: string[],
    options?: { targetTypes?: string[] },
  ): Promise<Map<string, DistributionRecord>> {
    if (names.length === 0) return new Map()

    let query = this.db
      .selectFrom('capability_distribution')
      .selectAll()
      .where('category', '=', category)
      .where('name', 'in', names)
    if (options?.targetTypes && options.targetTypes.length > 0) {
      query = query.where('target_type', 'in', options.targetTypes)
    }
    const rows = await query.execute()

    const map = new Map<string, DistributionRecord>()
    const ranking = new Map<string, number>()
    const targetTypeRank = new Map(
      (options?.targetTypes ?? []).map((targetType, index) => [targetType, index]),
    )
    for (const row of rows) {
      const candidate = rowToDistribution(row)
      const rank = targetTypeRank.get(candidate.targetType) ?? Number.MAX_SAFE_INTEGER
      const existingRank = ranking.get(candidate.name) ?? Number.MAX_SAFE_INTEGER
      if (!map.has(candidate.name) || rank < existingRank) {
        map.set(candidate.name, candidate)
        ranking.set(candidate.name, rank)
      }
    }
    return map
  }

  /** Batch-get all distribution target types for multiple names in one category. */
  async batchGetDistributionTargetTypes(
    category: ManagedCapabilityCategory,
    names: string[],
  ): Promise<Map<string, string[]>> {
    if (names.length === 0) return new Map()

    const rows = await this.db
      .selectFrom('capability_distribution')
      .select(['name', 'target_type'])
      .where('category', '=', category)
      .where('name', 'in', names)
      .execute()

    const grouped = new Map<string, Set<string>>()
    for (const row of rows) {
      const set = grouped.get(row.name) ?? new Set<string>()
      set.add(row.target_type)
      grouped.set(row.name, set)
    }

    const result = new Map<string, string[]>()
    for (const [name, targetTypes] of grouped.entries()) {
      result.set(
        name,
        [...targetTypes].sort(
          (a, b) => distributionTargetTypeRank(a) - distributionTargetTypeRank(b) || a.localeCompare(b),
        ),
      )
    }

    return result
  }

  /** Get all distribution records for a specific capability (may have multiple targets). */
  async getDistributionsFor(
    category: ManagedCapabilityCategory,
    name: string,
  ): Promise<DistributionRecord[]> {
    const rows = await this.db
      .selectFrom('capability_distribution')
      .selectAll()
      .where('category', '=', category)
      .where('name', '=', name)
      .execute()

    return rows.map(rowToDistribution)
  }

  async getAllDistributions(): Promise<DistributionRecord[]> {
    const rows = await this.db
      .selectFrom('capability_distribution')
      .selectAll()
      .execute()

    return rows.map(rowToDistribution)
  }

  async removeDistribution(
    category: ManagedCapabilityCategory,
    name: string,
    targetType: string,
  ): Promise<void> {
    await this.db
      .deleteFrom('capability_distribution')
      .where('category', '=', category)
      .where('name', '=', name)
      .where('target_type', '=', targetType)
      .execute()
  }

  /** Remove ALL distribution records for a capability (any target type) */
  async removeAllDistributions(category: ManagedCapabilityCategory, name: string): Promise<void> {
    await this.db
      .deleteFrom('capability_distribution')
      .where('category', '=', category)
      .where('name', '=', name)
      .execute()
  }

  // ── Path Migration ──────────────────────────────────────────────

  /**
   * Migrate distribution target_path entries when a project directory is renamed.
   *
   * Performs a prefix replacement on portable paths: all records whose target_path
   * starts with the old project path are updated to use the new project path.
   *
   * Both old and new paths are converted to portable format (~ prefix) to match
   * the DB persistence boundary convention.
   *
   * @returns Number of distribution records updated.
   */
  async migrateDistributionPaths(params: {
    oldProjectPath: string
    newProjectPath: string
  }): Promise<number> {
    const oldPortable = toPortablePath(params.oldProjectPath)
    const newPortable = toPortablePath(params.newProjectPath)

    if (oldPortable === newPortable) return 0

    // Use ESCAPE clause so _ and % in paths are treated as literals, not wildcards.
    const likePattern = `${escapeLike(oldPortable)}/%`
    const oldLen = oldPortable.length

    // Prefix-only replacement: newPortable || substr(target_path, len(old) + 1)
    // This is safer than SQL replace() which does global string substitution.
    const result = await this.db
      .updateTable('capability_distribution')
      .set({
        target_path: sql<string>`${newPortable} || substr(target_path, ${oldLen + 1})`,
      })
      .where((eb) =>
        eb.or([
          eb('target_path', '=', oldPortable),
          eb('target_path', 'like', sql<string>`${likePattern} escape '\\'`),
        ]),
      )
      .execute()

    const count = result.reduce((sum, r) => sum + Number(r.numUpdatedRows ?? 0), 0)
    if (count > 0) {
      log.info(`Migrated ${count} distribution path(s): ${oldPortable} → ${newPortable}`)
    }
    return count
  }

  // ── Import Tracking ───────────────────────────────────────────────

  async recordImport(record: ImportRecord): Promise<void> {
    const portablePath = toPortablePath(record.sourcePath)

    await this.db
      .insertInto('capability_import')
      .values({
        category: record.category,
        name: record.name,
        source_path: portablePath,
        source_origin: record.sourceOrigin,
        source_hash: record.sourceHash,
        imported_at: record.importedAt,
        ...(record.marketplaceId != null ? { marketplace_id: record.marketplaceId } : {}),
        ...(record.marketSlug != null ? { market_slug: record.marketSlug } : {}),
        ...(record.marketVersion != null ? { market_version: record.marketVersion } : {}),
      })
      .onConflict((oc) =>
        oc
          .columns(['category', 'name'])
          .doUpdateSet({
            source_path: portablePath,
            source_origin: record.sourceOrigin,
            source_hash: record.sourceHash,
            imported_at: record.importedAt,
            ...(record.marketplaceId != null ? { marketplace_id: record.marketplaceId } : {}),
            ...(record.marketSlug != null ? { market_slug: record.marketSlug } : {}),
            ...(record.marketVersion != null ? { market_version: record.marketVersion } : {}),
          }),
      )
      .execute()
  }

  async getImport(category: ManagedCapabilityCategory, name: string): Promise<ImportRecord | null> {
    const row = await this.db
      .selectFrom('capability_import')
      .selectAll()
      .where('category', '=', category)
      .where('name', '=', name)
      .executeTakeFirst()

    return row ? rowToImport(row) : null
  }

  /** Batch-get import records for multiple names in one category. */
  async batchGetImports(
    category: ManagedCapabilityCategory,
    names: string[],
  ): Promise<Map<string, ImportRecord>> {
    if (names.length === 0) return new Map()

    const rows = await this.db
      .selectFrom('capability_import')
      .selectAll()
      .where('category', '=', category)
      .where('name', 'in', names)
      .execute()

    const map = new Map<string, ImportRecord>()
    for (const row of rows) {
      map.set(row.name, rowToImport(row))
    }
    return map
  }

  /** Get all import records from a specific source origin (e.g. 'claude-code'). */
  async getImportsByOrigin(origin: ImportRecord['sourceOrigin']): Promise<ImportRecord[]> {
    const rows = await this.db
      .selectFrom('capability_import')
      .selectAll()
      .where('source_origin', '=', origin)
      .execute()

    return rows.map(rowToImport)
  }

  // ── Version History (M6) ────────────────────────────────────────

  /** Record a version snapshot for a capability (called on every save) */
  async recordVersion(params: {
    category: ManagedCapabilityCategory
    name: string
    contentHash: string
    snapshot: string
  }): Promise<void> {
    await this.db
      .insertInto('capability_version')
      .values({
        category: params.category,
        name: params.name,
        content_hash: params.contentHash,
        snapshot: params.snapshot,
        created_at: Date.now(),
      } as unknown as import('../../database/types').CapabilityVersionTable)
      .execute()
  }

  /** Get version history for a capability (newest first, with limit) */
  async getVersionHistory(
    category: ManagedCapabilityCategory,
    name: string,
    limit = 20,
  ): Promise<VersionRecord[]> {
    const rows = await this.db
      .selectFrom('capability_version')
      .selectAll()
      .where('category', '=', category)
      .where('name', '=', name)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map(rowToVersion)
  }

  /** Get a specific version by ID */
  async getVersion(id: number): Promise<VersionRecord | null> {
    const row = await this.db
      .selectFrom('capability_version')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()

    return row ? rowToVersion(row) : null
  }

  /**
   * Prune old versions, keeping only the latest N per capability.
   * Uses a subquery to avoid exceeding SQLite's SQLITE_MAX_VARIABLE_NUMBER (999) limit.
   */
  async pruneVersions(category: ManagedCapabilityCategory, name: string, keepCount = 50): Promise<number> {
    // Subquery: IDs to keep (latest N)
    const keepSubquery = this.db
      .selectFrom('capability_version')
      .select('id')
      .where('category', '=', category)
      .where('name', '=', name)
      .orderBy('created_at', 'desc')
      .limit(keepCount)

    // Delete everything NOT in the keep set
    const result = await this.db
      .deleteFrom('capability_version')
      .where('category', '=', category)
      .where('name', '=', name)
      .where('id', 'not in', keepSubquery)
      .execute()

    // Kysely returns DeleteResult[] — extract numDeletedRows
    const deleted = result.reduce((sum, r) => sum + Number(r.numDeletedRows ?? 0), 0)
    return deleted
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function resolveProjectId(projectId?: string): string {
  return projectId ?? GLOBAL_SCOPE_ID
}

function distributionTargetTypeRank(targetType: string): number {
  if (targetType.startsWith('claude-code-')) return 0
  if (targetType.startsWith('codex-')) return 1
  return 2
}

// ─── Row Mappers (validate at the DB boundary) ─────────────────────────

function rowToToggle(row: CapabilityStateTable): CapabilityToggle {
  return {
    enabled: row.enabled === 1,
    tags: safeJsonParse<string[]>(row.tags, []),
    sortOrder: row.sort_order,
  }
}

function rowToDistribution(row: CapabilityDistributionTable): DistributionRecord {
  return {
    category: assertCategory(row.category),
    name: row.name,
    targetType: row.target_type,
    targetPath: toAbsolutePath(row.target_path),
    strategy: VALID_STRATEGIES.has(row.strategy) ? (row.strategy as 'copy' | 'symlink') : 'copy',
    contentHash: row.content_hash,
    distributedAt: row.distributed_at,
  }
}

function rowToImport(row: CapabilityImportTable): ImportRecord {
  const knownOrigin = VALID_ORIGINS.has(row.source_origin)
    ? (row.source_origin as ImportRecord['sourceOrigin'])
    : 'unknown'

  if (knownOrigin === 'unknown' && row.source_origin !== 'unknown') {
    log.warn(`Unknown source_origin in capability_import: "${row.source_origin}"`)
  }

  return {
    category: assertCategory(row.category),
    name: row.name,
    sourcePath: toAbsolutePath(row.source_path),
    sourceOrigin: knownOrigin,
    sourceHash: row.source_hash,
    importedAt: row.imported_at,
  }
}

function rowToVersion(row: CapabilityVersionTable): VersionRecord {
  return {
    id: row.id,
    category: assertCategory(row.category),
    name: row.name,
    contentHash: row.content_hash,
    snapshot: row.snapshot,
    createdAt: row.created_at,
  }
}

/** Validate that a DB string is a known capability category. */
function assertCategory(value: string): ManagedCapabilityCategory {
  if (ALL_MANAGED_CATEGORIES.includes(value as ManagedCapabilityCategory)) {
    return value as ManagedCapabilityCategory
  }
  // Log corruption — this can only happen if DB was manually edited.
  // Throwing would surface the issue to callers instead of silently spreading bad data.
  log.warn(`Unknown capability category in DB: "${value}" — expected one of ${ALL_MANAGED_CATEGORIES.join(', ')}`)
  throw new Error(`Invalid capability category: ${value}`)
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

// ─── Path Portability (persistence boundary) ────────────────────────────
//
// Paths in the DB use `~` to represent the home directory, making them
// portable across machines / usernames. Conversion happens at the
// read/write boundary — all code above works with absolute paths.

const _homeDirCache = os.homedir()

/**
 * Convert an absolute path to a portable DB representation.
 *
 *   /Users/alice/.claude/skills/foo/SKILL.md → ~/.claude/skills/foo/SKILL.md
 *
 * Paths not rooted in the home directory (project paths, special URIs)
 * are returned unchanged.
 */
function toPortablePath(absolutePath: string): string {
  if (absolutePath.startsWith(_homeDirCache)) {
    return HOME_TOKEN + absolutePath.slice(_homeDirCache.length)
  }
  return absolutePath
}

/**
 * Expand a portable DB path back to an absolute path.
 *
 *   ~/.claude/skills/foo/SKILL.md → /Users/alice/.claude/skills/foo/SKILL.md
 *
 * Non-portable paths (legacy absolute paths, special URIs) pass through unchanged.
 */
function toAbsolutePath(portablePath: string): string {
  if (portablePath.startsWith(HOME_TOKEN + '/') || portablePath === HOME_TOKEN) {
    return _homeDirCache + portablePath.slice(HOME_TOKEN.length)
  }
  return portablePath
}

/**
 * Escape SQL LIKE special characters (\\, %, _) in a literal string.
 * Backslash must be escaped first to avoid double-escaping the others.
 *
 * Consistent with the `escapeLikePattern` helper in `issueStore.ts`.
 */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&')
}
