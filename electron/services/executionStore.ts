// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'
import type { Database, ScheduleExecutionTable } from '../database/types'
import type {
  ScheduleExecution,
  ExecutionStatus,
  ExecutionTriggerType,
} from '../../src/shared/types'

// ─── Row <-> Domain object mappers ─────────────────────────────────────────

function rowToExecution(row: ScheduleExecutionTable): ScheduleExecution {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    pipelineId: row.pipeline_id,
    pipelineStepOrder: row.pipeline_step_order,
    triggerType: row.trigger_type as ExecutionTriggerType,
    triggerDetail: row.trigger_detail,
    status: row.status as ExecutionStatus,
    resolvedPrompt: row.resolved_prompt,
    sessionId: row.session_id,
    issueId: row.issue_id,
    error: row.error,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  }
}

function executionToRow(exec: ScheduleExecution): ScheduleExecutionTable {
  return {
    id: exec.id,
    schedule_id: exec.scheduleId,
    pipeline_id: exec.pipelineId,
    pipeline_step_order: exec.pipelineStepOrder,
    trigger_type: exec.triggerType,
    trigger_detail: exec.triggerDetail,
    status: exec.status,
    resolved_prompt: exec.resolvedPrompt,
    session_id: exec.sessionId,
    issue_id: exec.issueId,
    error: exec.error,
    scheduled_at: exec.scheduledAt,
    started_at: exec.startedAt,
    completed_at: exec.completedAt,
    duration_ms: exec.durationMs,
    cost_usd: exec.costUsd,
    input_tokens: exec.inputTokens,
    output_tokens: exec.outputTokens,
  }
}

export class ExecutionStore {
  constructor(private readonly db: Kysely<Database>) {}

  async add(execution: ScheduleExecution): Promise<void> {
    await this.db
      .insertInto('schedule_executions')
      .values(executionToRow(execution))
      .execute()
  }

  async get(id: string): Promise<ScheduleExecution | null> {
    const row = await this.db
      .selectFrom('schedule_executions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? rowToExecution(row) : null
  }

  async updateStatus(
    id: string,
    status: ExecutionStatus,
    completedAt: number | null,
    error?: string | null
  ): Promise<void> {
    const updates: Record<string, unknown> = { status }
    if (completedAt != null) {
      updates.completed_at = completedAt
      const exec = await this.get(id)
      if (exec) {
        updates.duration_ms = completedAt - exec.startedAt
      }
    }
    if (error !== undefined) updates.error = error
    await this.db
      .updateTable('schedule_executions')
      .set(updates)
      .where('id', '=', id)
      .execute()
  }

  async updateSessionInfo(
    id: string,
    sessionId: string,
    costUsd?: number,
    inputTokens?: number,
    outputTokens?: number
  ): Promise<void> {
    const updates: Record<string, unknown> = { session_id: sessionId }
    if (costUsd !== undefined) updates.cost_usd = costUsd
    if (inputTokens !== undefined) updates.input_tokens = inputTokens
    if (outputTokens !== undefined) updates.output_tokens = outputTokens
    await this.db
      .updateTable('schedule_executions')
      .set(updates)
      .where('id', '=', id)
      .execute()
  }

  async listBySchedule(
    scheduleId: string,
    limit: number = 50
  ): Promise<ScheduleExecution[]> {
    const rows = await this.db
      .selectFrom('schedule_executions')
      .selectAll()
      .where('schedule_id', '=', scheduleId)
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute()
    return rows.map(rowToExecution)
  }

  /** Find the single running execution for a given sessionId, or null if not found. */
  async findRunningBySessionId(sessionId: string): Promise<ScheduleExecution | null> {
    const row = await this.db
      .selectFrom('schedule_executions')
      .selectAll()
      .where('session_id', '=', sessionId)
      .where('status', '=', 'running')
      .executeTakeFirst()
    return row ? rowToExecution(row) : null
  }

  /** Find the latest execution linked to any candidate session ID. */
  async findLatestBySessionIds(sessionIds: string[]): Promise<ScheduleExecution | null> {
    if (sessionIds.length === 0) return null
    const row = await this.db
      .selectFrom('schedule_executions')
      .selectAll()
      .where('session_id', 'in', sessionIds)
      .orderBy('started_at', 'desc')
      .executeTakeFirst()
    return row ? rowToExecution(row) : null
  }

  /** Return all executions currently stuck in `running` state (across all schedules). */
  async listAllRunning(): Promise<ScheduleExecution[]> {
    const rows = await this.db
      .selectFrom('schedule_executions')
      .selectAll()
      .where('status', '=', 'running')
      .execute()
    return rows.map(rowToExecution)
  }

  /**
   * Cancel orphaned executions in a single batch UPDATE.
   *
   * Unlike N individual `updateStatus()` calls, this issues one query
   * and computes `duration_ms` directly in SQL — no N+1 round-trips.
   */
  async batchCancelOrphaned(executionIds: string[], completedAt: number): Promise<void> {
    if (executionIds.length === 0) return

    await this.db
      .updateTable('schedule_executions')
      .set({
        status: 'cancelled',
        completed_at: completedAt,
        duration_ms: sql<number>`(${sql.lit(completedAt)} - started_at)`,
      })
      .where('id', 'in', executionIds)
      .execute()
  }

  async countRunning(scheduleId: string): Promise<number> {
    const result = await this.db
      .selectFrom('schedule_executions')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('schedule_id', '=', scheduleId)
      .where('status', '=', 'running')
      .executeTakeFirst()
    return result?.count ?? 0
  }
}
