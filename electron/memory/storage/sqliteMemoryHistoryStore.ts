// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import type { Database } from '../../database/types'
import { generateId } from '../../shared/identity'
import type { IMemoryHistoryStore, MemoryHistoryEntry } from './types'

/**
 * SQLite implementation of IMemoryHistoryStore.
 * Writes audit trail entries to the memory_history table.
 */
export class SqliteMemoryHistoryStore implements IMemoryHistoryStore {
  constructor(private readonly db: Kysely<Database>) {}

  async record(entry: MemoryHistoryEntry): Promise<void> {
    await this.db
      .insertInto('memory_history')
      .values({
        id: generateId(),
        memory_id: entry.memoryId,
        event: entry.event,
        previous_content: entry.previousContent ?? null,
        new_content: entry.newContent ?? null,
        actor: entry.actor,
        source: entry.source ?? null,
        created_at: Date.now(),
      })
      .execute()
  }
}
