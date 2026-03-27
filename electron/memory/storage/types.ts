// SPDX-License-Identifier: Apache-2.0

/**
 * Storage-agnostic interface for memory persistence.
 *
 * Implementations:
 *   - SqliteMemoryStorage  — Kysely + FTS5 (default)
 *   - MarkdownMemoryStorage — file-based (future)
 *   - RemoteMemoryStorage   — REST API (future)
 *
 * Design decisions:
 *   - Single interface (not split into CRUD/Query/Settings) because all callers
 *     use the full surface and every backend must implement everything.
 *   - search() is intentionally abstract — each backend provides its best strategy
 *     (FTS5, grep, Elasticsearch, etc.). Weak backends can fall back to list+filter.
 *   - History/audit is NOT part of this interface — it's a cross-cutting concern
 *     handled by the AuditableMemoryStorage decorator.
 */

import type {
  MemoryItem,
  MemoryListParams,
  MemorySearchParams,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryStats,
  MemorySettings,
  MemoryStatus,
} from '@shared/types'

// ─── Count Params ──────────────────────────────────────────────────

export interface MemoryCountParams {
  scope?: string
  projectId?: string
  status?: MemoryStatus
}

// ─── Core Storage Interface ────────────────────────────────────────

export interface IMemoryStorage {
  // ── Core CRUD ─────────────────────────────────────────────────
  get(id: string): Promise<MemoryItem | null>
  create(input: MemoryCreateInput): Promise<MemoryItem>
  update(id: string, patch: MemoryUpdateInput): Promise<MemoryItem | null>
  delete(id: string): Promise<void>
  bulkDelete(ids: string[]): Promise<void>
  bulkArchive(ids: string[]): Promise<void>

  // ── Status Transitions ────────────────────────────────────────
  confirm(id: string, by: 'user' | 'auto'): Promise<MemoryItem | null>
  reject(id: string): Promise<void>
  archive(id: string): Promise<void>

  // ── Query ─────────────────────────────────────────────────────
  list(params: MemoryListParams): Promise<MemoryItem[]>
  /** Full-text search. Backend-specific quality — simple backends may fall back to substring match. */
  search(params: MemorySearchParams): Promise<MemoryItem[]>
  count(params: MemoryCountParams): Promise<number>
  getStats(projectId?: string): Promise<MemoryStats>

  // ── Access Tracking ───────────────────────────────────────────
  incrementAccess(id: string): Promise<void>

  // ── Lifecycle ─────────────────────────────────────────────────
  cleanupExpired(): Promise<number>

  // ── Settings ──────────────────────────────────────────────────
  getSettings(projectId?: string): Promise<MemorySettings>
  updateSettings(projectId: string | null, patch: Partial<MemorySettings>): Promise<MemorySettings>
}

// ─── Audit History Interface ───────────────────────────────────────

export interface MemoryHistoryEntry {
  memoryId: string
  event: string
  previousContent: string | null
  newContent: string | null
  actor: string
  source?: string | null
}

/** Optional audit trail storage. Used by AuditableMemoryStorage decorator. */
export interface IMemoryHistoryStore {
  record(entry: MemoryHistoryEntry): Promise<void>
}
