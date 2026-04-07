// SPDX-License-Identifier: Apache-2.0

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { Database, SessionLifecycleOperationTable } from '../database/types'
import type {
  SessionLifecycleOperation,
  SessionLifecycleOperationState,
} from '../../src/shared/types'

function rowToOperation(row: SessionLifecycleOperationTable): SessionLifecycleOperation {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolUseId: row.tool_use_id,
    operationIndex: row.operation_index,
    entity: row.entity as SessionLifecycleOperation['entity'],
    action: row.action as SessionLifecycleOperation['action'],
    normalizedPayload: JSON.parse(row.normalized_payload_json) as Record<string, unknown>,
    summary: JSON.parse(row.summary_json) as Record<string, unknown>,
    warnings: JSON.parse(row.warnings_json) as string[],
    confirmationMode: row.confirmation_mode as SessionLifecycleOperation['confirmationMode'],
    state: row.state as SessionLifecycleOperation['state'],
    idempotencyKey: row.idempotency_key,
    resultSnapshot: row.result_snapshot_json
      ? (JSON.parse(row.result_snapshot_json) as Record<string, unknown>)
      : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    appliedAt: row.applied_at,
  }
}

function operationToRow(operation: SessionLifecycleOperation): SessionLifecycleOperationTable {
  return {
    id: operation.id,
    session_id: operation.sessionId,
    tool_use_id: operation.toolUseId,
    operation_index: operation.operationIndex,
    entity: operation.entity,
    action: operation.action,
    normalized_payload_json: JSON.stringify(operation.normalizedPayload),
    summary_json: JSON.stringify(operation.summary),
    warnings_json: JSON.stringify(operation.warnings),
    confirmation_mode: operation.confirmationMode,
    state: operation.state,
    idempotency_key: operation.idempotencyKey,
    result_snapshot_json: operation.resultSnapshot ? JSON.stringify(operation.resultSnapshot) : null,
    error_code: operation.errorCode,
    error_message: operation.errorMessage,
    created_at: operation.createdAt,
    updated_at: operation.updatedAt,
    applied_at: operation.appliedAt,
  }
}

export class SessionLifecycleOperationStore {
  constructor(private readonly db: Kysely<Database>) {}

  getDb(): Kysely<Database> {
    return this.db
  }

  async withTransaction<T>(
    fn: (store: SessionLifecycleOperationStore, db: Kysely<Database>) => Promise<T>
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const txStore = new SessionLifecycleOperationStore(trx as unknown as Kysely<Database>)
      return fn(txStore, trx as unknown as Kysely<Database>)
    })
  }

  async upsert(operation: SessionLifecycleOperation): Promise<void> {
    const row = operationToRow(operation)
    await this.db
      .insertInto('session_lifecycle_operations')
      .values(row)
      .onConflict((oc) =>
        oc.columns(['session_id', 'tool_use_id', 'operation_index']).doUpdateSet({
          entity: row.entity,
          action: row.action,
          normalized_payload_json: row.normalized_payload_json,
          summary_json: row.summary_json,
          warnings_json: row.warnings_json,
          confirmation_mode: row.confirmation_mode,
          state: row.state,
          idempotency_key: row.idempotency_key,
          result_snapshot_json: row.result_snapshot_json,
          error_code: row.error_code,
          error_message: row.error_message,
          updated_at: row.updated_at,
          applied_at: row.applied_at,
        })
      )
      .execute()
  }

  async getById(id: string): Promise<SessionLifecycleOperation | null> {
    const row = await this.db
      .selectFrom('session_lifecycle_operations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? rowToOperation(row) : null
  }

  async findBySessionToolUseOperationIndex(params: {
    sessionId: string
    toolUseId: string
    operationIndex: number
  }): Promise<SessionLifecycleOperation | null> {
    const row = await this.db
      .selectFrom('session_lifecycle_operations')
      .selectAll()
      .where('session_id', '=', params.sessionId)
      .where('tool_use_id', '=', params.toolUseId)
      .where('operation_index', '=', params.operationIndex)
      .executeTakeFirst()
    return row ? rowToOperation(row) : null
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<SessionLifecycleOperation | null> {
    const row = await this.db
      .selectFrom('session_lifecycle_operations')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst()
    return row ? rowToOperation(row) : null
  }

  async listBySession(sessionId: string): Promise<SessionLifecycleOperation[]> {
    const rows = await this.db
      .selectFrom('session_lifecycle_operations')
      .selectAll()
      .where('session_id', '=', sessionId)
      .orderBy('created_at', 'asc')
      .orderBy('operation_index', 'asc')
      .execute()
    return rows.map(rowToOperation)
  }

  async transitionStateCompareAndSet(params: {
    id: string
    fromState: SessionLifecycleOperationState
    toState: SessionLifecycleOperationState
    updatedAt: number
    appliedAt?: number | null
    resultSnapshot?: Record<string, unknown> | null
    errorCode?: string | null
    errorMessage?: string | null
  }): Promise<boolean> {
    const result = await this.db
      .updateTable('session_lifecycle_operations')
      .set({
        state: params.toState,
        updated_at: params.updatedAt,
        applied_at: params.appliedAt ?? null,
        result_snapshot_json: params.resultSnapshot ? JSON.stringify(params.resultSnapshot) : null,
        error_code: params.errorCode ?? null,
        error_message: params.errorMessage ?? null,
      })
      .where('id', '=', params.id)
      .where('state', '=', params.fromState)
      .executeTakeFirst()

    return Number(result?.numUpdatedRows ?? 0n) === 1
  }

  async markFailed(params: {
    id: string
    errorCode: string | null
    errorMessage: string | null
    updatedAt: number
  }): Promise<void> {
    await this.db
      .updateTable('session_lifecycle_operations')
      .set({
        state: 'failed',
        error_code: params.errorCode,
        error_message: params.errorMessage,
        updated_at: params.updatedAt,
      })
      .where('id', '=', params.id)
      .execute()
  }

  async countByState(sessionId: string): Promise<Record<SessionLifecycleOperationState, number>> {
    const rows = await this.db
      .selectFrom('session_lifecycle_operations')
      .select('state')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('session_id', '=', sessionId)
      .groupBy('state')
      .execute()

    const out: Record<SessionLifecycleOperationState, number> = {
      pending_confirmation: 0,
      applying: 0,
      applied: 0,
      failed: 0,
      cancelled: 0,
    }

    for (const row of rows) {
      const key = row.state as SessionLifecycleOperationState
      if (key in out) out[key] = Number(row.count)
    }

    return out
  }

  async compactOldApplied(sessionId: string, keep: number): Promise<number> {
    if (keep <= 0) {
      const result = await this.db
        .deleteFrom('session_lifecycle_operations')
        .where('session_id', '=', sessionId)
        .where('state', '=', 'applied')
        .executeTakeFirst()
      return Number(result?.numDeletedRows ?? 0n)
    }

    const cutoffRows = await this.db
      .selectFrom('session_lifecycle_operations')
      .select('created_at')
      .where('session_id', '=', sessionId)
      .where('state', '=', 'applied')
      .orderBy('created_at', 'desc')
      .limit(keep)
      .execute()

    if (cutoffRows.length < keep) return 0
    const cutoff = cutoffRows[cutoffRows.length - 1].created_at

    const result = await this.db
      .deleteFrom('session_lifecycle_operations')
      .where('session_id', '=', sessionId)
      .where('state', '=', 'applied')
      .where('created_at', '<', cutoff)
      .executeTakeFirst()

    return Number(result?.numDeletedRows ?? 0n)
  }

  async nextOperationIndex(sessionId: string, toolUseId: string): Promise<number> {
    const row = await this.db
      .selectFrom('session_lifecycle_operations')
      .select(sql<number>`COALESCE(MAX(operation_index), -1)`.as('maxIndex'))
      .where('session_id', '=', sessionId)
      .where('tool_use_id', '=', toolUseId)
      .executeTakeFirst()
    const maxIndex = Number(row?.maxIndex ?? -1)
    return maxIndex + 1
  }
}
