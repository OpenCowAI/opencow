// SPDX-License-Identifier: Apache-2.0

import type { ExecutionContext, TriggerEvent } from '../../../src/shared/types'
import type { ScheduleStore } from '../scheduleStore'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleRetryScheduler')

export class RetryScheduler {
  private pendingRetries = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private deps: {
      scheduleStore: ScheduleStore
      onTrigger: (event: TriggerEvent) => void
    }
  ) {}

  handleResult(ctx: ExecutionContext): void {
    if (ctx.execution.status !== 'failed') return

    const { schedule } = ctx
    const policy = schedule.failurePolicy
    const failures = schedule.consecutiveFailures + 1
    log.info('Retry scheduler received failed execution', {
      scheduleId: schedule.id,
      executionId: ctx.execution.id,
      failures,
      maxRetries: policy.maxRetries,
      pauseAfterConsecutiveFailures: policy.pauseAfterConsecutiveFailures,
    })

    // Too many consecutive failures → auto-pause
    if (failures >= policy.pauseAfterConsecutiveFailures) {
      this.pauseSchedule(
        schedule.id,
        `Auto-paused: ${failures} consecutive failures (threshold: ${policy.pauseAfterConsecutiveFailures})`
      )
      log.warn('Retry scheduler auto-paused schedule due to consecutive failures', {
        scheduleId: schedule.id,
        failures,
      })
      return
    }

    // Within retry limit → schedule retry
    if (failures <= policy.maxRetries) {
      const delay =
        policy.retryBackoff === 'exponential'
          ? policy.retryDelayMs * Math.pow(2, failures - 1)
          : policy.retryDelayMs

      this.scheduleRetry(schedule.id, delay)
      log.info('Retry scheduled', {
        scheduleId: schedule.id,
        failures,
        retryBackoff: policy.retryBackoff,
        delayMs: delay,
      })
    }
  }

  private scheduleRetry(scheduleId: string, delayMs: number): void {
    // Cancel any existing retry for this schedule
    const existing = this.pendingRetries.get(scheduleId)
    if (existing) {
      clearTimeout(existing)
      log.debug('Cancelled existing pending retry before scheduling new one', { scheduleId })
    }

    const timer = setTimeout(() => {
      this.pendingRetries.delete(scheduleId)
      log.info('Retry trigger fired', { scheduleId })
      this.deps.onTrigger({
        scheduleId,
        reason: 'retry',
        timestamp: Date.now(),
      })
    }, delayMs)

    this.pendingRetries.set(scheduleId, timer)
  }

  private pauseSchedule(scheduleId: string, reason: string): void {
    this.deps.scheduleStore
      .update(scheduleId, { status: 'paused' } as Partial<import('../../../src/shared/types').Schedule>)
      .catch((err) => {
        log.error('Failed to auto-pause schedule in retry scheduler', { scheduleId, reason }, err)
      })
    // The ScheduleService will dispatch the paused event
  }

  /** Cancel all pending retries — called during shutdown */
  cancelAll(): void {
    const total = this.pendingRetries.size
    for (const timer of this.pendingRetries.values()) {
      clearTimeout(timer)
    }
    this.pendingRetries.clear()
    log.info('Cancelled all pending retries', { total })
  }
}
