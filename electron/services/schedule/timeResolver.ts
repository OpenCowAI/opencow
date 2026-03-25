// SPDX-License-Identifier: Apache-2.0

import type { TriggerEvent, Schedule, MissedExecutionPolicy } from '../../../src/shared/types'
import type { ScheduleStore } from '../scheduleStore'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleTimeResolver')

export class TimeResolver {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly CHECK_INTERVAL = 15_000 // 15 seconds
  private suspendedAt: number | null = null

  constructor(
    private deps: {
      store: ScheduleStore
      onTrigger: (event: TriggerEvent) => void
    }
  ) {}

  start(): void {
    if (this.timer) {
      log.debug('TimeResolver start skipped because timer already exists')
      return
    }
    this.timer = setInterval(() => this.tick(), this.CHECK_INTERVAL)
    // Also run immediately on start
    this.tick()
    log.info('TimeResolver started', { checkIntervalMs: this.CHECK_INTERVAL })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log.info('TimeResolver stopped')
    }
  }

  markSuspended(): void {
    this.suspendedAt = Date.now()
    log.info('TimeResolver marked suspended', { suspendedAt: this.suspendedAt })
  }

  async catchUpMissedExecutions(): Promise<void> {
    if (!this.suspendedAt) {
      log.debug('catchUpMissedExecutions skipped because suspendedAt is not set')
      return
    }

    const suspendedAt = this.suspendedAt
    this.suspendedAt = null

    try {
      const dueSchedules = await this.deps.store.findDue(Date.now())
      log.info('catchUpMissedExecutions evaluating due schedules', {
        dueCount: dueSchedules.length,
        suspendedAt,
      })
      for (const schedule of dueSchedules) {
        const policy = schedule.missedPolicy
        this.handleMissed(schedule, policy, suspendedAt)
      }
    } catch (err) {
      log.error('catchUpMissedExecutions failed', err)
    }
  }

  private handleMissed(
    schedule: Schedule,
    policy: MissedExecutionPolicy,
    suspendedAt: number
  ): void {
    switch (policy) {
      case 'skip':
        // Skip all missed, just wait for next cycle
        log.debug('Missed execution skipped by policy', { scheduleId: schedule.id, policy })
        break
      case 'run_once':
        // Run once regardless of how many were missed
        log.info('Missed execution replayed once', { scheduleId: schedule.id, policy })
        this.deps.onTrigger({
          scheduleId: schedule.id,
          reason: 'catchup',
          timestamp: Date.now(),
          scheduledAt: schedule.nextRunAt ?? Date.now(),
        })
        break
      case 'run_if_within': {
        // Run if missed within reasonable window (30 minutes)
        const missedWindow = 30 * 60 * 1000
        if (schedule.nextRunAt && schedule.nextRunAt > suspendedAt - missedWindow) {
          log.info('Missed execution replayed within allowed window', {
            scheduleId: schedule.id,
            policy,
            nextRunAt: schedule.nextRunAt,
            suspendedAt,
          })
          this.deps.onTrigger({
            scheduleId: schedule.id,
            reason: 'catchup',
            timestamp: Date.now(),
            scheduledAt: schedule.nextRunAt,
          })
        } else {
          log.debug('Missed execution skipped because it is outside allowed window', {
            scheduleId: schedule.id,
            policy,
            nextRunAt: schedule.nextRunAt ?? null,
            suspendedAt,
          })
        }
        break
      }
    }
  }

  private async tick(): Promise<void> {
    try {
      const now = Date.now()
      const dueSchedules = await this.deps.store.findDue(now)
      if (dueSchedules.length > 0) {
        log.info('TimeResolver tick found due schedules', {
          dueCount: dueSchedules.length,
        })
      }

      for (const schedule of dueSchedules) {
        this.deps.onTrigger({
          scheduleId: schedule.id,
          reason: 'scheduled',
          timestamp: now,
          scheduledAt: schedule.nextRunAt!,
        })
      }
    } catch (err) {
      log.error('TimeResolver tick failed', err)
    }
  }
}
