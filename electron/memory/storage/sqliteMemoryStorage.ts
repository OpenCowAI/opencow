// SPDX-License-Identifier: Apache-2.0

/**
 * SQLite implementation of IMemoryStorage.
 *
 * Uses Kysely for type-safe queries, FTS5 for full-text search,
 * and standard SQL for aggregations. This is the default storage
 * backend for OpenCow.
 *
 * History/audit is handled externally by AuditableMemoryStorage —
 * this class is pure storage with no side effects.
 */

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../../database/types'
import { generateId } from '../../shared/identity'
import { safeJsonParse } from '../../shared/safeJson'
import { extractCount, extractAvg } from '../queryHelpers'
import { validateCreateInput, clampConfidence, isValidMemoryScope, isValidMemoryCategory, isValidMemoryStatus, isValidMemorySource, isValidConfirmedBy } from '../validation'
import { createLogger } from '../../platform/logger'
import type { IMemoryStorage, MemoryCountParams } from './types'
import type {
  MemoryItem,
  MemoryListParams,
  MemorySearchParams,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemorySettings,
} from '@shared/types'
import { MEMORY_DEFAULTS } from '@shared/types'

const log = createLogger('SqliteMemoryStorage')

// ─── FTS5 Escaping ─────────────────────────────────────────────────

function sanitizeFTS5Token(token: string): string {
  return token.replace(/[*+\-:.()]/g, '').trim()
}

// ─── Row ↔ Domain Mapping ──────────────────────────────────────────

function rowToItem(row: Record<string, unknown>): MemoryItem {
  const scope = row.scope as string
  const category = row.category as string
  const status = row.status as string
  const source = row.source as string
  const confirmedBy = row.confirmed_by as string | null

  if (!isValidMemoryScope(scope)) {
    log.warn('Invalid scope in DB row, defaulting to "user"', { id: row.id, scope })
  }
  if (!isValidMemoryCategory(category)) {
    log.warn('Invalid category in DB row, defaulting to "fact"', { id: row.id, category })
  }
  if (!isValidMemoryStatus(status)) {
    log.warn('Invalid status in DB row, defaulting to "pending"', { id: row.id, status })
  }
  if (!isValidMemorySource(source)) {
    log.warn('Invalid source in DB row, defaulting to "session"', { id: row.id, source })
  }

  return {
    id: String(row.id ?? ''),
    scope: isValidMemoryScope(scope) ? scope : 'user',
    projectId: (row.project_id as string) ?? null,
    content: String(row.content ?? ''),
    category: isValidMemoryCategory(category) ? category : 'fact',
    tags: safeJsonParse((row.tags as string) || '[]', [] as string[]),
    confidence: clampConfidence(row.confidence as number),
    source: isValidMemorySource(source) ? source : 'session',
    sourceId: (row.source_id as string) ?? null,
    reasoning: (row.reasoning as string) ?? null,
    status: isValidMemoryStatus(status) ? status : 'pending',
    confirmedBy: isValidConfirmedBy(confirmedBy) ? confirmedBy : null,
    version: typeof row.version === 'number' ? row.version : 1,
    previousId: (row.previous_id as string) ?? null,
    accessCount: typeof row.access_count === 'number' ? row.access_count : 0,
    lastAccessedAt: (row.last_accessed_at as number) ?? null,
    expiresAt: (row.expires_at as number) ?? null,
    createdAt: (row.created_at as number) ?? 0,
    updatedAt: (row.updated_at as number) ?? 0,
  }
}

// ─── SqliteMemoryStorage ───────────────────────────────────────────

export class SqliteMemoryStorage implements IMemoryStorage {
  constructor(private readonly db: Kysely<Database>) {}

  async get(id: string): Promise<MemoryItem | null> {
    const row = await this.db
      .selectFrom('memories')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? rowToItem(row) : null
  }

  async create(input: MemoryCreateInput): Promise<MemoryItem> {
    validateCreateInput(input)

    const id = generateId()
    const now = Date.now()

    await this.db
      .insertInto('memories')
      .values({
        id,
        scope: input.scope,
        project_id: input.projectId ?? null,
        content: input.content,
        category: input.category,
        tags: JSON.stringify(input.tags ?? []),
        confidence: clampConfidence(input.confidence ?? 0.7),
        source: input.source,
        source_id: input.sourceId ?? null,
        reasoning: input.reasoning ?? null,
        status: 'pending',
        confirmed_by: null,
        version: 1,
        previous_id: null,
        access_count: 0,
        last_accessed_at: null,
        expires_at: null,
        created_at: now,
        updated_at: now,
      })
      .execute()

    const item = await this.get(id)
    if (!item) {
      throw new Error(`Failed to read back created memory: ${id}`)
    }
    return item
  }

  async update(id: string, patch: MemoryUpdateInput): Promise<MemoryItem | null> {
    const existing = await this.get(id)
    if (!existing) return null

    const now = Date.now()
    const setClauses: Record<string, unknown> = { updated_at: now }

    if (patch.content !== undefined) setClauses.content = patch.content
    if (patch.category !== undefined) setClauses.category = patch.category
    if (patch.scope !== undefined) setClauses.scope = patch.scope
    if (patch.projectId !== undefined) setClauses.project_id = patch.projectId
    if (patch.tags !== undefined) setClauses.tags = JSON.stringify(patch.tags)
    if (patch.confidence !== undefined) setClauses.confidence = clampConfidence(patch.confidence)
    if (patch.status !== undefined) setClauses.status = patch.status

    if (patch.content !== undefined && patch.content !== existing.content) {
      setClauses.version = existing.version + 1
    }

    await this.db
      .updateTable('memories')
      .set(setClauses)
      .where('id', '=', id)
      .execute()

    return this.get(id)
  }

  async confirm(id: string, by: 'user' | 'auto'): Promise<MemoryItem | null> {
    await this.db
      .updateTable('memories')
      .set({ status: 'confirmed', confirmed_by: by, updated_at: Date.now() })
      .where('id', '=', id)
      .execute()
    return this.get(id)
  }

  async reject(id: string): Promise<void> {
    await this.db
      .updateTable('memories')
      .set({ status: 'rejected', updated_at: Date.now() })
      .where('id', '=', id)
      .execute()
  }

  async archive(id: string): Promise<void> {
    await this.db
      .updateTable('memories')
      .set({ status: 'archived', updated_at: Date.now() })
      .where('id', '=', id)
      .execute()
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('memories').where('id', '=', id).execute()
  }

  async bulkDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.deleteFrom('memories').where('id', 'in', ids).execute()
  }

  async bulkArchive(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db
      .updateTable('memories')
      .set({ status: 'archived', updated_at: Date.now() })
      .where('id', 'in', ids)
      .execute()
  }

  async list(params: MemoryListParams): Promise<MemoryItem[]> {
    let query = this.db.selectFrom('memories').selectAll()

    if (params.scope) query = query.where('scope', '=', params.scope)
    if (params.projectId) query = query.where('project_id', '=', params.projectId)
    if (params.category) query = query.where('category', '=', params.category)
    if (params.status) query = query.where('status', '=', params.status)
    if (params.source) query = query.where('source', '=', params.source)

    const sortBy = params.sortBy ?? 'updated_at'
    const sortOrder = params.sortOrder ?? 'desc'
    query = query.orderBy(sortBy, sortOrder)

    if (params.limit) query = query.limit(params.limit)
    if (params.offset) query = query.offset(params.offset)

    const rows = await query.execute()
    return rows.map(rowToItem)
  }

  async search(params: MemorySearchParams): Promise<MemoryItem[]> {
    const status = params.status ?? 'confirmed'
    const limit = params.limit ?? 20

    if (!params.query.trim()) {
      return this.list({ ...params, status, limit, sortBy: 'updated_at' })
    }

    const tokens = params.query
      .trim()
      .split(/\s+/)
      .map(sanitizeFTS5Token)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"`)

    if (tokens.length === 0) {
      return this.list({ ...params, status, limit, sortBy: 'updated_at' })
    }

    const ftsQuery = tokens.join(' AND ')

    try {
      let query = this.db
        .selectFrom('memories')
        .selectAll()
        .where('status', '=', status)
        .where(
          sql`rowid`,
          'in',
          sql`(SELECT rowid FROM memories_fts WHERE memories_fts MATCH ${ftsQuery})`,
        )

      if (params.scope) query = query.where('scope', '=', params.scope)
      if (params.projectId) query = query.where('project_id', '=', params.projectId)
      if (params.category) query = query.where('category', '=', params.category)

      query = query.orderBy('confidence', 'desc').orderBy('updated_at', 'desc').limit(limit)

      const rows = await query.execute()
      return rows.map(rowToItem)
    } catch (err) {
      log.warn('FTS5 search failed, falling back to list', {
        query: params.query,
        error: err instanceof Error ? err.message : String(err),
      })
      return this.list({ ...params, status, limit, sortBy: 'updated_at' })
    }
  }

  async incrementAccess(id: string): Promise<void> {
    await this.db
      .updateTable('memories')
      .set({
        access_count: sql`access_count + 1`,
        last_accessed_at: Date.now(),
      })
      .where('id', '=', id)
      .execute()
  }

  async count(params: MemoryCountParams): Promise<number> {
    let query = this.db
      .selectFrom('memories')
      .select(sql<number>`count(*)`.as('cnt'))

    if (params.scope) query = query.where('scope', '=', params.scope)
    if (params.projectId) query = query.where('project_id', '=', params.projectId)
    if (params.status) query = query.where('status', '=', params.status)

    const result = await query.executeTakeFirst()
    return extractCount(result)
  }

  async getStats(projectId?: string): Promise<MemoryStats> {
    const baseConditions = projectId
      ? this.db.selectFrom('memories').where('project_id', '=', projectId)
      : this.db.selectFrom('memories')

    const cntExpr = sql<number>`count(*)`.as('cnt')
    const avgExpr = sql<number>`avg(confidence)`.as('avg_conf')

    const total = await baseConditions.select(cntExpr).where('status', '!=', 'rejected').executeTakeFirst()
    const active = await baseConditions.select(cntExpr).where('status', '=', 'confirmed').executeTakeFirst()
    const archived = await baseConditions.select(cntExpr).where('status', '=', 'archived').executeTakeFirst()
    const pending = await baseConditions.select(cntExpr).where('status', '=', 'pending').executeTakeFirst()
    const avgConf = await baseConditions.select(avgExpr).where('status', '=', 'confirmed').executeTakeFirst()

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const recentWeek = await baseConditions.select(cntExpr).where('created_at', '>=', weekAgo).where('status', '!=', 'rejected').executeTakeFirst()

    const categories = await baseConditions.select(['category', cntExpr]).where('status', '=', 'confirmed').groupBy('category').execute()
    const byCategory: Record<string, number> = {}
    for (const row of categories) byCategory[row.category] = extractCount(row)

    const scopes = await baseConditions.select(['scope', cntExpr]).where('status', '=', 'confirmed').groupBy('scope').execute()
    const byScope = { user: 0, project: 0 }
    for (const row of scopes) {
      if (row.scope === 'user') byScope.user = extractCount(row)
      if (row.scope === 'project') byScope.project = extractCount(row)
    }

    return {
      total: extractCount(total),
      active: extractCount(active),
      archived: extractCount(archived),
      pending: extractCount(pending),
      byCategory,
      byScope,
      avgConfidence: extractAvg(avgConf),
      recentWeekAdded: extractCount(recentWeek),
    }
  }

  // ── Settings ─────────────────────────────────────────────────────

  async getSettings(projectId?: string): Promise<MemorySettings> {
    const key = projectId ?? ''
    const row = await this.db
      .selectFrom('memory_settings')
      .selectAll()
      .where('project_id', '=', key)
      .executeTakeFirst()

    if (!row) return { ...MEMORY_DEFAULTS }

    return {
      enabled: row.enabled === 1,
      autoConfirm: row.auto_confirm === 1,
      confirmTimeoutSeconds: row.confirm_timeout_seconds,
      extractionDelaySeconds: row.extraction_delay_seconds ?? MEMORY_DEFAULTS.extractionDelaySeconds,
      extractionSources: safeJsonParse(row.extraction_sources, MEMORY_DEFAULTS.extractionSources),
      maxMemories: row.max_memories,
      autoArchiveDays: row.auto_archive_days,
    }
  }

  async updateSettings(projectId: string | null, patch: Partial<MemorySettings>): Promise<MemorySettings> {
    const key = projectId ?? ''
    const existing = await this.getSettings(projectId ?? undefined)
    const merged = { ...existing, ...patch }
    const now = Date.now()

    await this.db
      .insertInto('memory_settings')
      .values({
        project_id: key,
        enabled: merged.enabled ? 1 : 0,
        auto_confirm: merged.autoConfirm ? 1 : 0,
        confirm_timeout_seconds: merged.confirmTimeoutSeconds,
        extraction_delay_seconds: merged.extractionDelaySeconds,
        extraction_sources: JSON.stringify(merged.extractionSources),
        max_memories: merged.maxMemories,
        auto_archive_days: merged.autoArchiveDays,
        updated_at: now,
      })
      .onConflict((oc) =>
        oc.column('project_id').doUpdateSet({
          enabled: merged.enabled ? 1 : 0,
          auto_confirm: merged.autoConfirm ? 1 : 0,
          confirm_timeout_seconds: merged.confirmTimeoutSeconds,
          extraction_delay_seconds: merged.extractionDelaySeconds,
          extraction_sources: JSON.stringify(merged.extractionSources),
          max_memories: merged.maxMemories,
          auto_archive_days: merged.autoArchiveDays,
          updated_at: now,
        }),
      )
      .execute()

    return merged
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async cleanupExpired(): Promise<number> {
    const now = Date.now()
    const rows = await this.db
      .selectFrom('memories')
      .select('id')
      .where('expires_at', 'is not', null)
      .where('expires_at', '<=', now)
      .execute()

    if (rows.length === 0) return 0

    const ids = rows.map((r) => r.id)
    await this.db.deleteFrom('memories').where('id', 'in', ids).execute()
    return ids.length
  }
}
