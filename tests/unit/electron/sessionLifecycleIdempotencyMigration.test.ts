// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import * as m053 from '../../../electron/database/migrations/053_create_session_lifecycle_operations'
import * as m054 from '../../../electron/database/migrations/054_scope_lifecycle_idempotency_by_session'

describe('session lifecycle idempotency index migration', () => {
  let db: Kysely<unknown>
  let raw: BetterSqlite3.Database

  beforeEach(() => {
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = new Kysely({ dialect: new SqliteDialect({ database: raw }) })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('changes idempotency uniqueness from global to per-session scope', async () => {
    await m053.up(db)

    const now = Date.now()
    const insert = (id: string, sessionId: string, idempotencyKey: string) => {
      raw.exec(`
        INSERT INTO session_lifecycle_operations (
          id, session_id, tool_use_id, operation_index, entity, action,
          normalized_payload_json, summary_json, warnings_json,
          confirmation_mode, state, idempotency_key,
          result_snapshot_json, error_code, error_message,
          created_at, updated_at, applied_at
        ) VALUES (
          '${id}', '${sessionId}', 'tool-1', 0, 'schedule', 'create',
          '{}', '{}', '[]',
          'required', 'pending_confirmation', '${idempotencyKey}',
          NULL, NULL, NULL,
          ${now}, ${now}, NULL
        )
      `)
    }

    insert('lop-1', 'session-a', 'idem-shared')
    expect(() => insert('lop-2', 'session-b', 'idem-shared')).toThrow()

    await m054.up(db)

    expect(() => insert('lop-3', 'session-b', 'idem-shared')).not.toThrow()
    expect(() => insert('lop-4', 'session-a', 'idem-shared')).toThrow()
  })
})
