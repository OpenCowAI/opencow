// SPDX-License-Identifier: Apache-2.0

import { sql, type Kysely } from 'kysely'
import type { Database, ScheduleTable } from '../database/types'
import type {
  Schedule,
  ScheduleFilter,
  ScheduleTrigger,
  ScheduleAction,
  FailurePolicy,
  ScheduleStatus,
  SchedulePriority,
  MissedExecutionPolicy,
  ConcurrencyPolicy,
} from '../../src/shared/types'

/** Escape LIKE wildcard characters (`%`, `_`, `\`) so they match literally. */
function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_\\]/g, '\\$&')
}

// ─── Row <-> Domain object mappers ─────────────────────────────────────────

function rowToSchedule(row: ScheduleTable): Schedule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    trigger: JSON.parse(row.trigger_config) as ScheduleTrigger,
    action: JSON.parse(row.action_config) as ScheduleAction,
    priority: row.priority as SchedulePriority,
    failurePolicy: JSON.parse(row.failure_policy) as FailurePolicy,
    missedPolicy: row.missed_policy as MissedExecutionPolicy,
    concurrencyPolicy: row.concurrency_policy as ConcurrencyPolicy,
    status: row.status as ScheduleStatus,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status as Schedule['lastRunStatus'],
    lastRunError: row.last_run_error,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    maxExecutions: row.max_executions ?? undefined,
    executionCount: row.execution_count,
    consecutiveFailures: row.consecutive_failures,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function scheduleToRow(schedule: Schedule): ScheduleTable {
  return {
    id: schedule.id,
    name: schedule.name,
    description: schedule.description,
    trigger_config: JSON.stringify(schedule.trigger),
    action_config: JSON.stringify(schedule.action),
    priority: schedule.priority,
    failure_policy: JSON.stringify(schedule.failurePolicy),
    missed_policy: schedule.missedPolicy,
    concurrency_policy: schedule.concurrencyPolicy,
    status: schedule.status,
    next_run_at: schedule.nextRunAt,
    last_run_at: schedule.lastRunAt,
    last_run_status: schedule.lastRunStatus,
    last_run_error: schedule.lastRunError,
    start_date: schedule.startDate ?? null,
    end_date: schedule.endDate ?? null,
    max_executions: schedule.maxExecutions ?? null,
    execution_count: schedule.executionCount,
    consecutive_failures: schedule.consecutiveFailures,
    project_id: schedule.projectId,
    created_at: schedule.createdAt,
    updated_at: schedule.updatedAt,
  }
}

export class ScheduleStore {
  constructor(private readonly db: Kysely<Database>) {}

  async add(schedule: Schedule): Promise<void> {
    await this.db.insertInto('schedules').values(scheduleToRow(schedule)).execute()
  }

  async get(id: string): Promise<Schedule | null> {
    const row = await this.db
      .selectFrom('schedules')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? rowToSchedule(row) : null
  }

  async list(filter?: ScheduleFilter): Promise<Schedule[]> {
    let query = this.db.selectFrom('schedules').selectAll()
    if (filter?.statuses?.length) {
      query = query.where('status', 'in', filter.statuses)
    }
    if (filter?.projectId) {
      query = query.where('project_id', '=', filter.projectId)
    }
    if (filter?.search) {
      const term = `%${escapeLikePattern(filter.search)}%`
      query = query.where(
        sql<boolean>`name LIKE ${term} ESCAPE '\\'`,
      )
    }
    const rows = await query.orderBy('created_at', 'desc').execute()
    return rows.map(rowToSchedule)
  }

  async update(id: string, patch: Partial<Schedule>): Promise<Schedule | null> {
    const existing = await this.get(id)
    if (!existing) return null

    const updates: Record<string, unknown> = { updated_at: Date.now() }
    if (patch.name !== undefined) updates.name = patch.name
    if (patch.description !== undefined) updates.description = patch.description
    if (patch.trigger !== undefined) updates.trigger_config = JSON.stringify(patch.trigger)
    if (patch.action !== undefined) updates.action_config = JSON.stringify(patch.action)
    if (patch.priority !== undefined) updates.priority = patch.priority
    if (patch.failurePolicy !== undefined)
      updates.failure_policy = JSON.stringify(patch.failurePolicy)
    if (patch.missedPolicy !== undefined) updates.missed_policy = patch.missedPolicy
    if (patch.concurrencyPolicy !== undefined)
      updates.concurrency_policy = patch.concurrencyPolicy
    if (patch.status !== undefined) updates.status = patch.status
    if (patch.nextRunAt !== undefined) updates.next_run_at = patch.nextRunAt
    if (patch.lastRunAt !== undefined) updates.last_run_at = patch.lastRunAt
    if (patch.lastRunStatus !== undefined) updates.last_run_status = patch.lastRunStatus
    if (patch.lastRunError !== undefined) updates.last_run_error = patch.lastRunError
    if (patch.executionCount !== undefined) updates.execution_count = patch.executionCount
    if (patch.consecutiveFailures !== undefined)
      updates.consecutive_failures = patch.consecutiveFailures
    if (patch.projectId !== undefined) updates.project_id = patch.projectId

    await this.db.updateTable('schedules').set(updates).where('id', '=', id).execute()
    return this.get(id)
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('schedules')
      .where('id', '=', id)
      .executeTakeFirst()
    return (result?.numDeletedRows ?? 0n) > 0n
  }

  /**
   * Delete all schedules belonging to a project.
   * Called during project deletion to maintain data integrity.
   * @returns Number of deleted schedules.
   */
  async deleteByProjectId(projectId: string): Promise<number> {
    const result = await this.db
      .deleteFrom('schedules')
      .where('project_id', '=', projectId)
      .executeTakeFirst()
    return Number(result?.numDeletedRows ?? 0n)
  }

  /** Find all active schedules where nextRunAt <= now */
  async findDue(now: number): Promise<Schedule[]> {
    const rows = await this.db
      .selectFrom('schedules')
      .selectAll()
      .where('status', '=', 'active')
      .where('next_run_at', '<=', now)
      .where('next_run_at', 'is not', null)
      .execute()
    return rows.map(rowToSchedule)
  }

  /** Find all active schedules that have an event trigger configured (in-memory filter) */
  findByEventTriggerSync(allSchedules: Schedule[]): Schedule[] {
    return allSchedules.filter((s) => s.status === 'active' && s.trigger.event != null)
  }

  /** Find all active schedules that have an event trigger configured */
  async findByEventTrigger(): Promise<Schedule[]> {
    const rows = await this.db
      .selectFrom('schedules')
      .selectAll()
      .where('status', '=', 'active')
      .execute()
    // Filter in-memory since trigger_config is JSON
    return rows.map(rowToSchedule).filter((s) => s.trigger.event != null)
  }

  async updateNextRun(id: string, nextRunAt: number | null): Promise<void> {
    await this.db
      .updateTable('schedules')
      .set({ next_run_at: nextRunAt, updated_at: Date.now() })
      .where('id', '=', id)
      .execute()
  }

  async incrementExecution(
    id: string,
    status: 'success' | 'failed' | 'skipped'
  ): Promise<void> {
    const schedule = await this.get(id)
    if (!schedule) return

    const updates: Record<string, unknown> = {
      execution_count: schedule.executionCount + 1,
      last_run_at: Date.now(),
      last_run_status: status,
      updated_at: Date.now(),
    }

    if (status === 'failed') {
      updates.consecutive_failures = schedule.consecutiveFailures + 1
    } else {
      updates.consecutive_failures = 0
      updates.last_run_error = null
    }

    await this.db.updateTable('schedules').set(updates).where('id', '=', id).execute()
  }
}
