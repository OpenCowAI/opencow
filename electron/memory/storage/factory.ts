// SPDX-License-Identifier: Apache-2.0

/**
 * Factory for creating storage-agnostic IMemoryStorage instances.
 *
 * Currently supports only 'sqlite'. Future backends (markdown, remote API)
 * will be registered here with their own config shapes.
 */

import type { Kysely } from 'kysely'
import type { Database } from '../../database/types'
import type { IMemoryStorage } from './types'
import { SqliteMemoryStorage } from './sqliteMemoryStorage'
import { SqliteMemoryHistoryStore } from './sqliteMemoryHistoryStore'
import { AuditableMemoryStorage } from './auditableMemoryStorage'

// ─── Config Types ──────────────────────────────────────────────────

interface SqliteStorageConfig {
  type: 'sqlite'
  db: Kysely<Database>
  /** Set to false to disable audit history. Default: true. */
  auditHistory?: boolean
}

// Future:
// interface MarkdownStorageConfig {
//   type: 'markdown'
//   basePath: string
// }
// interface RemoteStorageConfig {
//   type: 'remote'
//   baseUrl: string
//   apiKey: string
// }

export type MemoryStorageConfig = SqliteStorageConfig
// Future: | MarkdownStorageConfig | RemoteStorageConfig

// ─── Factory ───────────────────────────────────────────────────────

export function createMemoryStorage(config: MemoryStorageConfig): IMemoryStorage {
  switch (config.type) {
    case 'sqlite': {
      const raw = new SqliteMemoryStorage(config.db)
      if (config.auditHistory === false) return raw
      const history = new SqliteMemoryHistoryStore(config.db)
      return new AuditableMemoryStorage(raw, history)
    }
    default:
      throw new Error(`Unknown memory storage type: ${(config as { type: string }).type}`)
  }
}
