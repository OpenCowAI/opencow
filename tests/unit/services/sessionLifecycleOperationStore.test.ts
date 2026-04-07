// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import type { Database } from '../../../electron/database/types'
import * as m053 from '../../../electron/database/migrations/053_create_session_lifecycle_operations'
import * as m054 from '../../../electron/database/migrations/054_scope_lifecycle_idempotency_by_session'
import { SessionLifecycleOperationStore } from '../../../electron/services/sessionLifecycleOperationStore'
import type { SessionLifecycleOperation } from '../../../src/shared/types'

function makeOperation(overrides: Partial<SessionLifecycleOperation> = {}): SessionLifecycleOperation {
  const now = Date.now()
  return {
    id: overrides.id ?? 'lop-1',
    sessionId: overrides.sessionId ?? 'session-1',
    toolUseId: overrides.toolUseId ?? 'tool-1',
    operationIndex: overrides.operationIndex ?? 0,
    entity: overrides.entity ?? 'schedule',
    action: overrides.action ?? 'create',
    normalizedPayload: overrides.normalizedPayload ?? { sessionId: overrides.sessionId ?? 'session-1', name: 'Daily' },
    summary: overrides.summary ?? { sessionId: overrides.sessionId ?? 'session-1', name: 'Daily' },
    warnings: overrides.warnings ?? [],
    confirmationMode: overrides.confirmationMode ?? 'required',
    state: overrides.state ?? 'pending_confirmation',
    idempotencyKey: overrides.idempotencyKey ?? 'idem-shared',
    resultSnapshot: overrides.resultSnapshot ?? null,
    errorCode: overrides.errorCode ?? null,
    errorMessage: overrides.errorMessage ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    appliedAt: overrides.appliedAt ?? null,
  }
}

describe('SessionLifecycleOperationStore.upsert', () => {
  let raw: BetterSqlite3.Database
  let db: Kysely<Database>
  let store: SessionLifecycleOperationStore

  beforeEach(async () => {
    raw = new BetterSqlite3(':memory:')
    raw.pragma('foreign_keys = ON')
    db = new Kysely<Database>({
      dialect: new SqliteDialect({ database: raw }),
    })
    await m053.up(db as unknown as Kysely<unknown>)
    await m054.up(db as unknown as Kysely<unknown>)
    store = new SessionLifecycleOperationStore(db)
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('returns existing operation instead of throwing when idempotency key races in same session', async () => {
    const first = makeOperation({
      id: 'lop-first',
      sessionId: 'session-1',
      toolUseId: 'tool-1',
      operationIndex: 0,
      idempotencyKey: 'idem-key',
    })
    const second = makeOperation({
      id: 'lop-second',
      sessionId: 'session-1',
      toolUseId: 'tool-2',
      operationIndex: 0,
      idempotencyKey: 'idem-key',
    })

    const firstResult = await store.upsert(first)
    const secondResult = await store.upsert(second)

    expect(firstResult.created).toBe(true)
    expect(secondResult.created).toBe(false)
    expect(secondResult.operation.id).toBe('lop-first')
  })

  it('allows same idempotency key in different sessions after scoped index migration', async () => {
    const first = makeOperation({
      id: 'lop-session-1',
      sessionId: 'session-1',
      idempotencyKey: 'idem-key',
    })
    const second = makeOperation({
      id: 'lop-session-2',
      sessionId: 'session-2',
      idempotencyKey: 'idem-key',
      normalizedPayload: { sessionId: 'session-2', name: 'Daily' },
      summary: { sessionId: 'session-2', name: 'Daily' },
    })

    const firstResult = await store.upsert(first)
    const secondResult = await store.upsert(second)

    expect(firstResult.created).toBe(true)
    expect(secondResult.created).toBe(true)
    expect(secondResult.operation.id).toBe('lop-session-2')
  })
})
