// SPDX-License-Identifier: Apache-2.0

/**
 * PackageRegistry — DB layer for installed package tracking.
 *
 * Provides CRUD operations on the `installed_packages` table.
 * Follows the same repository pattern as StateRepository:
 *   - Kysely<Database> injected via constructor
 *   - Upsert via INSERT ... ON CONFLICT DO UPDATE (no TOCTOU)
 *   - Domain types mapped from DB rows via rowToRecord()
 *   - snake_case DB columns, camelCase domain types
 */

import type { Kysely } from 'kysely'
import type { Database } from '../../database/types'
import type { ManagedCapabilityCategory, MarketplaceId } from '@shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('PackageRegistry')

// ─── Domain Types ────────────────────────────────────────────────────────

export interface InstalledPackageRecord {
  id: string
  prefix: string
  scope: 'global' | 'project'
  projectId: string
  marketplaceId: MarketplaceId
  slug: string
  version: string
  repoUrl: string
  author: string
  capabilities: Partial<Record<ManagedCapabilityCategory, string[]>>
  contentHash: string
  installedAt: number
  updatedAt: number
}

export interface PackageQuery {
  scope?: 'global' | 'project'
  projectId?: string
}

// ─── PackageRegistry ─────────────────────────────────────────────────────

export class PackageRegistry {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Register (upsert) an installed package.
   *
   * Uses ON CONFLICT on (scope, project_id, prefix) to handle re-installs.
   */
  async register(record: InstalledPackageRecord): Promise<void> {
    const row = recordToRow(record)
    await this.db
      .insertInto('installed_packages')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['scope', 'project_id', 'prefix']).doUpdateSet({
          marketplace_id: row.marketplace_id,
          slug: row.slug,
          version: row.version,
          repo_url: row.repo_url,
          author: row.author,
          capabilities: row.capabilities,
          content_hash: row.content_hash,
          updated_at: row.updated_at,
        }),
      )
      .execute()
    log.info(`Registered package "${record.prefix}" (${record.scope})`)
  }

  /**
   * Unregister a package by its DB ID.
   */
  async unregister(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('installed_packages')
      .where('id', '=', id)
      .executeTakeFirst()
    return BigInt(result.numDeletedRows ?? 0) > 0n
  }

  /**
   * Unregister a package by prefix within a scope.
   */
  async unregisterByPrefix(prefix: string, query: PackageQuery): Promise<boolean> {
    let qb = this.db.deleteFrom('installed_packages').where('prefix', '=', prefix)
    qb = applyQueryFilters(qb, query)
    const result = await qb.executeTakeFirst()
    return BigInt(result.numDeletedRows ?? 0) > 0n
  }

  /**
   * Find a package by its namespace prefix within a scope.
   */
  async findByPrefix(prefix: string, query: PackageQuery): Promise<InstalledPackageRecord | null> {
    let qb = this.db.selectFrom('installed_packages').selectAll().where('prefix', '=', prefix)
    qb = applyQueryFilters(qb, query)
    const row = await qb.executeTakeFirst()
    return row ? rowToRecord(row) : null
  }

  /**
   * Find a package by marketplace slug within a scope.
   */
  async findBySlug(slug: string, query: PackageQuery): Promise<InstalledPackageRecord | null> {
    let qb = this.db.selectFrom('installed_packages').selectAll().where('slug', '=', slug)
    qb = applyQueryFilters(qb, query)
    const row = await qb.executeTakeFirst()
    return row ? rowToRecord(row) : null
  }

  /**
   * List all packages matching the query filter.
   * Returns newest-first by default.
   */
  async list(query: PackageQuery): Promise<InstalledPackageRecord[]> {
    let qb = this.db.selectFrom('installed_packages').selectAll()
    qb = applyQueryFilters(qb, query)
    const rows = await qb.orderBy('installed_at', 'desc').execute()
    return rows.map(rowToRecord)
  }

  /**
   * Delete all packages for a given project (cascade on project deletion).
   */
  async deleteByProjectId(projectId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('installed_packages')
      .where('project_id', '=', projectId)
      .executeTakeFirst()
    const count = Number(result.numDeletedRows ?? 0)
    if (count > 0) {
      log.info(`Deleted ${count} package(s) for project ${projectId}`)
    }
    return count
  }

  /**
   * Count installed packages matching the query.
   */
  async count(query: PackageQuery): Promise<number> {
    let qb = this.db
      .selectFrom('installed_packages')
      .select((eb) => eb.fn.countAll<number>().as('count'))
    qb = applyQueryFilters(qb, query)
    const result = await qb.executeTakeFirst()
    return (result as { count: number } | undefined)?.count ?? 0
  }
}

// ─── Row ↔ Record mapping ────────────────────────────────────────────────

type InstalledPackageRow = Database['installed_packages']

function rowToRecord(row: InstalledPackageRow): InstalledPackageRecord {
  let capabilities: Partial<Record<ManagedCapabilityCategory, string[]>> = {}
  try {
    capabilities = JSON.parse(row.capabilities)
  } catch {
    log.warn(`Invalid capabilities JSON for package "${row.prefix}"`)
  }

  return {
    id: row.id,
    prefix: row.prefix,
    scope: row.scope as 'global' | 'project',
    projectId: row.project_id,
    marketplaceId: row.marketplace_id as MarketplaceId,
    slug: row.slug,
    version: row.version,
    repoUrl: row.repo_url,
    author: row.author,
    capabilities,
    contentHash: row.content_hash,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }
}

function recordToRow(record: InstalledPackageRecord): InstalledPackageRow {
  return {
    id: record.id,
    prefix: record.prefix,
    scope: record.scope,
    project_id: record.projectId,
    marketplace_id: record.marketplaceId,
    slug: record.slug,
    version: record.version,
    repo_url: record.repoUrl,
    author: record.author,
    capabilities: JSON.stringify(record.capabilities),
    content_hash: record.contentHash,
    installed_at: record.installedAt,
    updated_at: record.updatedAt,
  }
}

// ─── Query Helpers ───────────────────────────────────────────────────────

/**
 * Apply scope and projectId filters to a query builder.
 *
 * Uses the same pattern as StateRepository: global scope uses project_id = '',
 * project scope uses the actual projectId.
 *
 * Note: `as any` casts are needed because Kysely's SelectQueryBuilder and
 * DeleteQueryBuilder share `.where()` semantically but have incompatible
 * generic signatures. This is a known Kysely limitation for shared query helpers.
 * The column names are statically validated by the DB schema at migration time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyQueryFilters<T extends { where: (...args: any[]) => T }>(
  qb: T,
  query: PackageQuery,
): T {
  if (query.scope) {
    qb = (qb as any).where('scope', '=', query.scope)
  }
  if (query.projectId) {
    qb = (qb as any).where('project_id', '=', query.projectId)
  } else if (query.scope === 'global') {
    qb = (qb as any).where('project_id', '=', '')
  }
  return qb
}
