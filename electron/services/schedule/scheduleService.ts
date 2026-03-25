// SPDX-License-Identifier: Apache-2.0

import type {
  Schedule,
  SchedulePipeline,
  ScheduleExecution,
  ScheduleFilter,
  CreateScheduleInput,
  UpdateScheduleInput,
  CreatePipelineInput,
  UpdatePipelineInput,
  ScheduleTrigger,
  TriggerEvent,
  ExecutionContext,
  DataBusEvent,
  FailurePolicy,
} from '../../../src/shared/types'
import { generateId } from '../../shared/identity'
import type { ScheduleStore } from '../scheduleStore'
import type { PipelineStore } from '../pipelineStore'
import type { ExecutionStore } from '../executionStore'
import type { ExecutionPipeline } from './executionPipeline'
import type { RetryScheduler } from './retryScheduler'
import type { ChainResolver } from './chainResolver'
import type { NotificationEmitter } from './notificationEmitter'
import { calculateNextRun, previewNextRuns } from './nextRunCalculator'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleService')

const DEFAULT_FAILURE_POLICY: FailurePolicy = {
  maxRetries: 3,
  retryBackoff: 'exponential',
  retryDelayMs: 30_000,
  pauseAfterConsecutiveFailures: 5,
  notifyOnFailure: true,
  webhookOnFailure: false,
}

export class ScheduleService {
  constructor(
    private deps: {
      scheduleStore: ScheduleStore
      pipelineStore: PipelineStore
      executionStore: ExecutionStore
      pipeline: ExecutionPipeline
      retryScheduler: RetryScheduler
      chainResolver: ChainResolver
      notificationEmitter: NotificationEmitter
      dispatch: (event: DataBusEvent) => void
    }
  ) {}

  // === Schedule CRUD ===

  async create(input: CreateScheduleInput): Promise<Schedule> {
    const now = Date.now()
    const failurePolicy: FailurePolicy = {
      ...DEFAULT_FAILURE_POLICY,
      ...input.failurePolicy,
    }

    // action.projectId is the canonical source; top-level projectId is a
    // denormalized copy kept in sync for efficient DB-level queries.
    const canonicalProjectId = input.action.projectId ?? null

    const schedule: Schedule = {
      id: generateId(),
      name: input.name,
      description: input.description ?? '',
      trigger: input.trigger,
      action: input.action,
      priority: input.priority ?? 'normal',
      failurePolicy,
      missedPolicy: input.missedPolicy ?? 'skip',
      concurrencyPolicy: input.concurrencyPolicy ?? 'skip',
      status: 'active',
      nextRunAt: input.trigger.time
        ? calculateNextRun(input.trigger.time)
        : null,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      startDate: input.startDate,
      endDate: input.endDate,
      maxExecutions: input.maxExecutions,
      executionCount: 0,
      consecutiveFailures: 0,
      projectId: canonicalProjectId,
      createdAt: now,
      updatedAt: now,
    }

    await this.deps.scheduleStore.add(schedule)
    this.deps.dispatch({ type: 'schedule:created', payload: { schedule } })
    log.info('Schedule created', {
      scheduleId: schedule.id,
      name: schedule.name,
      actionType: schedule.action.type,
      projectId: schedule.projectId,
    })
    return schedule
  }

  async get(id: string): Promise<Schedule | null> {
    return this.deps.scheduleStore.get(id)
  }

  async list(filter?: ScheduleFilter): Promise<Schedule[]> {
    return this.deps.scheduleStore.list(filter)
  }

  async update(id: string, patch: UpdateScheduleInput): Promise<Schedule | null> {
    const updatePatch: Partial<Schedule> = {}

    if (patch.name !== undefined) updatePatch.name = patch.name
    if (patch.description !== undefined) updatePatch.description = patch.description
    if (patch.trigger !== undefined) {
      updatePatch.trigger = patch.trigger
      // Recalculate nextRunAt when trigger changes
      if (patch.trigger.time) {
        updatePatch.nextRunAt = calculateNextRun(patch.trigger.time)
      }
    }
    if (patch.action !== undefined) updatePatch.action = patch.action
    if (patch.priority !== undefined) updatePatch.priority = patch.priority
    if (patch.failurePolicy !== undefined) {
      const existing = await this.deps.scheduleStore.get(id)
      if (existing) {
        updatePatch.failurePolicy = { ...existing.failurePolicy, ...patch.failurePolicy }
      }
    }
    if (patch.missedPolicy !== undefined) updatePatch.missedPolicy = patch.missedPolicy
    if (patch.concurrencyPolicy !== undefined) updatePatch.concurrencyPolicy = patch.concurrencyPolicy

    // Keep the denormalized projectId column in sync with action.projectId
    // (canonical source). When the action changes, derive from it; otherwise
    // honour an explicit top-level projectId if provided.
    if (patch.action !== undefined) {
      updatePatch.projectId = patch.action.projectId ?? null
    } else if (patch.projectId !== undefined) {
      updatePatch.projectId = patch.projectId
    }

    const updated = await this.deps.scheduleStore.update(id, updatePatch)
    if (updated) {
      this.deps.dispatch({ type: 'schedule:updated', payload: { schedule: updated } })
      log.info('Schedule updated', {
        scheduleId: id,
        fields: Object.keys(updatePatch),
      })
    } else {
      log.warn('Schedule update skipped because schedule was not found', { scheduleId: id })
    }
    return updated
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.deps.scheduleStore.delete(id)
    if (result) {
      this.deps.dispatch({ type: 'schedule:deleted', payload: { scheduleId: id } })
      log.info('Schedule deleted', { scheduleId: id })
    } else {
      log.warn('Schedule delete skipped because schedule was not found', { scheduleId: id })
    }
    return result
  }

  async pause(id: string): Promise<Schedule | null> {
    const updated = await this.deps.scheduleStore.update(id, { status: 'paused' } as Partial<Schedule>)
    if (updated) {
      this.deps.dispatch({
        type: 'schedule:paused',
        payload: { scheduleId: id, reason: 'Manual pause' },
      })
      log.info('Schedule paused', { scheduleId: id, reason: 'manual' })
    } else {
      log.warn('Schedule pause skipped because schedule was not found', { scheduleId: id })
    }
    return updated
  }

  async resume(id: string): Promise<Schedule | null> {
    const schedule = await this.deps.scheduleStore.get(id)
    if (!schedule) return null

    const nextRunAt = schedule.trigger.time
      ? calculateNextRun(schedule.trigger.time)
      : null

    const updated = await this.deps.scheduleStore.update(id, {
      status: 'active',
      consecutiveFailures: 0,
      nextRunAt,
    } as Partial<Schedule>)

    if (updated) {
      this.deps.dispatch({ type: 'schedule:updated', payload: { schedule: updated } })
      log.info('Schedule resumed', { scheduleId: id })
    }
    return updated
  }

  async triggerNow(id: string): Promise<ScheduleExecution> {
    const schedule = await this.deps.scheduleStore.get(id)
    if (!schedule) throw new Error(`Schedule not found: ${id}`)
    log.info('Manual trigger requested', { scheduleId: id })

    const trigger: TriggerEvent = {
      scheduleId: id,
      reason: 'manual',
      timestamp: Date.now(),
    }

    return this.executeTrigger(schedule, trigger)
  }

  // === Pipeline CRUD ===

  async createPipeline(input: CreatePipelineInput): Promise<SchedulePipeline> {
    const now = Date.now()
    const pipeline: SchedulePipeline = {
      id: generateId(),
      name: input.name,
      description: input.description ?? '',
      steps: input.steps,
      failurePolicy: input.failurePolicy ?? 'stop_chain',
      status: 'active',
      projectId: input.projectId ?? null,
      createdAt: now,
      updatedAt: now,
    }

    await this.deps.pipelineStore.add(pipeline)
    log.info('Schedule pipeline created', {
      pipelineId: pipeline.id,
      name: pipeline.name,
      stepCount: pipeline.steps.length,
      projectId: pipeline.projectId,
    })
    return pipeline
  }

  async getPipeline(id: string): Promise<SchedulePipeline | null> {
    return this.deps.pipelineStore.get(id)
  }

  async listPipelines(): Promise<SchedulePipeline[]> {
    return this.deps.pipelineStore.list()
  }

  async updatePipeline(id: string, patch: UpdatePipelineInput): Promise<SchedulePipeline | null> {
    const updated = await this.deps.pipelineStore.update(id, patch)
    if (updated) {
      log.info('Schedule pipeline updated', { pipelineId: id, fields: Object.keys(patch) })
    } else {
      log.warn('Schedule pipeline update skipped because pipeline was not found', { pipelineId: id })
    }
    return updated
  }

  async deletePipeline(id: string): Promise<boolean> {
    const deleted = await this.deps.pipelineStore.delete(id)
    if (deleted) {
      log.info('Schedule pipeline deleted', { pipelineId: id })
    } else {
      log.warn('Schedule pipeline delete skipped because pipeline was not found', { pipelineId: id })
    }
    return deleted
  }

  // === Execution ===

  async listExecutions(scheduleId: string, limit?: number): Promise<ScheduleExecution[]> {
    return this.deps.executionStore.listBySchedule(scheduleId, limit)
  }

  previewNextRuns(trigger: ScheduleTrigger, count: number): number[] {
    if (!trigger.time) return []
    return previewNextRuns(trigger.time, count)
  }

  // === Engine Entry Point ===

  /**
   * Called by TimeResolver and EventListener when a trigger fires.
   * Builds ExecutionContext and runs through the pipeline.
   */
  async handleTrigger(event: TriggerEvent): Promise<void> {
    log.info('Schedule trigger received', {
      scheduleId: event.scheduleId,
      reason: event.reason,
      pipelineId: event.pipelineId ?? null,
      pipelineStepOrder: event.pipelineStepOrder ?? null,
      eventType: event.eventType ?? null,
    })
    const schedule = await this.deps.scheduleStore.get(event.scheduleId)
    if (!schedule) {
      log.warn('Schedule trigger ignored because schedule was not found', { scheduleId: event.scheduleId })
      return
    }
    if (schedule.status !== 'active') {
      log.debug('Schedule trigger ignored because schedule is not active', {
        scheduleId: schedule.id,
        status: schedule.status,
      })
      return
    }

    // Check date bounds
    const now = Date.now()
    if (schedule.startDate && now < schedule.startDate) {
      log.debug('Schedule trigger ignored because schedule has not reached startDate', {
        scheduleId: schedule.id,
        startDate: schedule.startDate,
        now,
      })
      return
    }
    if (schedule.endDate && now > schedule.endDate) {
      log.info('Schedule trigger ignored because schedule exceeded endDate', {
        scheduleId: schedule.id,
        endDate: schedule.endDate,
        now,
      })
      return
    }
    if (schedule.maxExecutions && schedule.executionCount >= schedule.maxExecutions) {
      await this.deps.scheduleStore.update(schedule.id, { status: 'completed' } as Partial<Schedule>)
      log.info('Schedule auto-completed after reaching maxExecutions', {
        scheduleId: schedule.id,
        maxExecutions: schedule.maxExecutions,
        executionCount: schedule.executionCount,
      })
      return
    }

    try {
      await this.executeTrigger(schedule, event)
    } catch (error) {
      // Catch unexpected errors to prevent crash
      log.error(`Trigger execution failed for ${schedule.id}`, error)
    }
  }

  private async executeTrigger(
    schedule: Schedule,
    trigger: TriggerEvent
  ): Promise<ScheduleExecution> {
    const now = Date.now()
    log.info('Schedule execution started', {
      scheduleId: schedule.id,
      triggerReason: trigger.reason,
      pipelineId: trigger.pipelineId ?? null,
      pipelineStepOrder: trigger.pipelineStepOrder ?? null,
    })

    // Create execution record
    const execution: ScheduleExecution = {
      id: generateId(),
      scheduleId: schedule.id,
      pipelineId: trigger.pipelineId ?? null,
      pipelineStepOrder: trigger.pipelineStepOrder ?? null,
      triggerType: trigger.reason,
      triggerDetail: trigger.eventType ?? null,
      status: 'running',
      resolvedPrompt: null,
      sessionId: null,
      issueId: null,
      error: null,
      scheduledAt: trigger.scheduledAt ?? now,
      startedAt: now,
      completedAt: null,
      durationMs: null,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    }

    // Dispatch executing event
    this.deps.dispatch({
      type: 'schedule:executing',
      payload: { scheduleId: schedule.id, executionId: execution.id },
    })

    // Build context
    const ctx: ExecutionContext = {
      schedule,
      trigger,
      execution,
      aborted: false,
      skipped: false,
    }

    // Run through pipeline
    await this.deps.pipeline.run(ctx)

    // Post-execution lifecycle
    this.deps.retryScheduler.handleResult(ctx)
    await this.deps.chainResolver.handleResult(ctx)
    this.deps.notificationEmitter.handleResult(ctx)

    // Calculate next run for time-based triggers
    if (schedule.trigger.time && trigger.reason !== 'retry') {
      const nextRunAt = calculateNextRun(schedule.trigger.time, now)
      await this.deps.scheduleStore.updateNextRun(schedule.id, nextRunAt)
      log.debug('Schedule next run updated', {
        scheduleId: schedule.id,
        nextRunAt,
      })
    }

    log.info('Schedule execution pipeline completed', {
      scheduleId: schedule.id,
      executionId: execution.id,
      status: ctx.execution.status,
      skipped: ctx.skipped,
      aborted: ctx.aborted,
      durationMs: Date.now() - now,
    })
    return ctx.execution
  }
}
