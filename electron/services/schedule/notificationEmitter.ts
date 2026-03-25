// SPDX-License-Identifier: Apache-2.0

import type { ExecutionContext, DataBusEvent } from '../../../src/shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleNotificationEmitter')

/** Minimal interface for inbox service */
interface InboxServiceLike {
  createScheduleNotification?(scheduleId: string, scheduleName: string, message: string): void
}

/** Minimal interface for webhook service */
interface WebhookServiceLike {
  dispatchEvent?(event: string, payload: Record<string, unknown>): void
}

export class NotificationEmitter {
  constructor(
    private deps: {
      inboxService?: InboxServiceLike
      webhookService?: WebhookServiceLike
      dispatch: (event: DataBusEvent) => void
    }
  ) {}

  handleResult(ctx: ExecutionContext): void {
    const { schedule, execution } = ctx

    // Only process completed executions (not still running)
    if (execution.status === 'running') return

    const isFailed = execution.status === 'failed' || execution.status === 'timeout'
    const { failurePolicy } = schedule

    // Inbox notification on failure
    if (isFailed && failurePolicy.notifyOnFailure && this.deps.inboxService?.createScheduleNotification) {
      const message = `Schedule "${schedule.name}" failed: ${execution.error ?? 'Unknown error'}`
      try {
        this.deps.inboxService.createScheduleNotification(schedule.id, schedule.name, message)
        log.info('Failure notification sent to inbox', {
          scheduleId: schedule.id,
          executionId: execution.id,
        })
      } catch (err) {
        log.error('Failed to send inbox failure notification', {
          scheduleId: schedule.id,
          executionId: execution.id,
        }, err)
      }
    }

    // Webhook on failure
    if (isFailed && failurePolicy.webhookOnFailure && this.deps.webhookService?.dispatchEvent) {
      try {
        this.deps.webhookService.dispatchEvent('schedule_failure', {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          executionId: execution.id,
          error: execution.error,
          consecutiveFailures: schedule.consecutiveFailures + 1,
        })
        log.info('Failure notification dispatched to webhook', {
          scheduleId: schedule.id,
          executionId: execution.id,
        })
      } catch (err) {
        log.error('Failed to dispatch webhook failure notification', {
          scheduleId: schedule.id,
          executionId: execution.id,
        }, err)
      }
    }

    // Auto-pause notification
    if (schedule.consecutiveFailures + 1 >= failurePolicy.pauseAfterConsecutiveFailures && isFailed) {
      this.deps.dispatch({
        type: 'schedule:paused',
        payload: {
          scheduleId: schedule.id,
          reason: `Auto-paused after ${schedule.consecutiveFailures + 1} consecutive failures`,
        },
      })
      log.warn('Auto-pause event dispatched due to consecutive failures', {
        scheduleId: schedule.id,
        failures: schedule.consecutiveFailures + 1,
      })
    }
  }
}
