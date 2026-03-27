// SPDX-License-Identifier: Apache-2.0

/**
 * AuditableMemoryStorage — decorator that wraps any IMemoryStorage
 * with audit history recording.
 *
 * Audited mutations:
 *   create, update, delete, bulkDelete, confirm, reject, archive,
 *   bulkArchive, cleanupExpired
 *
 * Intentionally NOT audited (too frequent or non-destructive):
 *   - incrementAccess — called per session context injection, would cause bloat
 *   - updateSettings — configuration changes, not memory data changes
 *
 * Read-only operations delegate directly with no overhead.
 *
 * History recording failures are logged but never block the mutation —
 * a successful mutation with missing audit is better than a failed mutation.
 *
 * Usage:
 *   const raw = new SqliteMemoryStorage(db)
 *   const history = new SqliteMemoryHistoryStore(db)
 *   const storage = new AuditableMemoryStorage(raw, history)
 */

import { createLogger } from '../../platform/logger'
import type { IMemoryStorage, IMemoryHistoryStore, MemoryCountParams, MemoryHistoryEntry } from './types'
import type {
  MemoryItem,
  MemoryListParams,
  MemorySearchParams,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemorySettings,
} from '@shared/types'

const log = createLogger('AuditableMemoryStorage')

export class AuditableMemoryStorage implements IMemoryStorage {
  constructor(
    private readonly inner: IMemoryStorage,
    private readonly history: IMemoryHistoryStore,
  ) {}

  // ── Read-only operations — delegate directly ─────────────────

  get(id: string): Promise<MemoryItem | null> {
    return this.inner.get(id)
  }

  list(params: MemoryListParams): Promise<MemoryItem[]> {
    return this.inner.list(params)
  }

  search(params: MemorySearchParams): Promise<MemoryItem[]> {
    return this.inner.search(params)
  }

  count(params: MemoryCountParams): Promise<number> {
    return this.inner.count(params)
  }

  getStats(projectId?: string): Promise<MemoryStats> {
    return this.inner.getStats(projectId)
  }

  incrementAccess(id: string): Promise<void> {
    return this.inner.incrementAccess(id)
  }

  getSettings(projectId?: string): Promise<MemorySettings> {
    return this.inner.getSettings(projectId)
  }

  updateSettings(projectId: string | null, patch: Partial<MemorySettings>): Promise<MemorySettings> {
    return this.inner.updateSettings(projectId, patch)
  }

  // ── Mutations with audit trail ───────────────────────────────

  async create(input: MemoryCreateInput): Promise<MemoryItem> {
    const item = await this.inner.create(input)
    await this.safeRecord({
      memoryId: item.id,
      event: 'created',
      previousContent: null,
      newContent: input.content,
      actor: 'system',
      source: input.sourceId,
    })
    return item
  }

  async update(id: string, patch: MemoryUpdateInput): Promise<MemoryItem | null> {
    const before = patch.content !== undefined ? await this.inner.get(id) : null
    const item = await this.inner.update(id, patch)

    if (item && patch.content !== undefined && before && patch.content !== before.content) {
      await this.safeRecord({
        memoryId: id,
        event: 'updated',
        previousContent: before.content,
        newContent: patch.content,
        actor: 'user',
      })
    }

    return item
  }

  async confirm(id: string, by: 'user' | 'auto'): Promise<MemoryItem | null> {
    const item = await this.inner.confirm(id, by)
    if (item) {
      await this.safeRecord({
        memoryId: id,
        event: 'confirmed',
        previousContent: null,
        newContent: null,
        actor: by === 'user' ? 'user' : 'auto',
      })
    }
    return item
  }

  async reject(id: string): Promise<void> {
    await this.inner.reject(id)
    await this.safeRecord({
      memoryId: id,
      event: 'rejected',
      previousContent: null,
      newContent: null,
      actor: 'user',
    })
  }

  async archive(id: string): Promise<void> {
    await this.inner.archive(id)
    await this.safeRecord({
      memoryId: id,
      event: 'archived',
      previousContent: null,
      newContent: null,
      actor: 'user',
    })
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.get(id)
    await this.inner.delete(id)
    if (existing) {
      await this.safeRecord({
        memoryId: id,
        event: 'deleted',
        previousContent: existing.content,
        newContent: null,
        actor: 'user',
      })
    }
  }

  async bulkDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    const items = await Promise.all(ids.map((id) => this.inner.get(id)))
    await this.inner.bulkDelete(ids)

    for (const item of items) {
      if (item) {
        await this.safeRecord({
          memoryId: item.id,
          event: 'deleted',
          previousContent: item.content,
          newContent: null,
          actor: 'user',
        })
      }
    }
  }

  async bulkArchive(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    await this.inner.bulkArchive(ids)

    for (const id of ids) {
      await this.safeRecord({
        memoryId: id,
        event: 'archived',
        previousContent: null,
        newContent: null,
        actor: 'user',
      })
    }
  }

  async cleanupExpired(): Promise<number> {
    // Snapshot ALL expired items (any status) before deletion for audit trail
    const allItems = await this.inner.list({ limit: 10000 })
    const now = Date.now()
    const expiring = allItems.filter((m) => m.expiresAt !== null && m.expiresAt <= now)

    const count = await this.inner.cleanupExpired()

    for (const item of expiring) {
      await this.safeRecord({
        memoryId: item.id,
        event: 'expired',
        previousContent: item.content,
        newContent: null,
        actor: 'system',
      })
    }

    return count
  }

  // ── Safe History Recording ───────────────────────────────────

  /**
   * Record a history entry, swallowing errors.
   * A successful mutation with missing audit is always better
   * than a failed mutation due to audit infrastructure issues.
   */
  private async safeRecord(entry: MemoryHistoryEntry): Promise<void> {
    try {
      await this.history.record(entry)
    } catch (err) {
      log.error('Failed to record audit history', {
        memoryId: entry.memoryId,
        event: entry.event,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}
