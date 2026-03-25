// SPDX-License-Identifier: Apache-2.0

import type { ExecutionContext, PipelineMiddleware } from '../../../../src/shared/types'
import type { ExecutionStore } from '../../executionStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Schedule:ConcurrencyGuard')

export class ConcurrencyGuard implements PipelineMiddleware {
  readonly name = 'ConcurrencyGuard'

  constructor(
    private deps: {
      executionStore: ExecutionStore
      maxConcurrent: number
    }
  ) {}

  async execute(ctx: ExecutionContext, next: () => Promise<void>): Promise<void> {
    const { schedule, trigger } = ctx

    // Manual triggers always bypass concurrency checks so the user gets
    // immediate feedback when clicking "Run Now".
    if (trigger.reason === 'manual') {
      log.debug('Concurrency check bypassed for manual trigger', {
        scheduleId: schedule.id,
        executionId: ctx.execution.id,
      })
      await next()
      return
    }

    const runningCount = await this.deps.executionStore.countRunning(schedule.id)

    if (runningCount >= this.deps.maxConcurrent) {
      switch (schedule.concurrencyPolicy) {
        case 'skip':
          ctx.skipped = true
          ctx.skipReason = `Concurrency limit reached (${runningCount}/${this.deps.maxConcurrent})`
          log.info('Execution skipped by concurrency guard', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            concurrencyPolicy: schedule.concurrencyPolicy,
            runningCount,
            maxConcurrent: this.deps.maxConcurrent,
          })
          return
        case 'queue':
          // For MVP, queue behaves like skip with a note
          ctx.skipped = true
          ctx.skipReason = `Queued — ${runningCount} executions running`
          log.info('Execution queued by concurrency guard (MVP skip behavior)', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            concurrencyPolicy: schedule.concurrencyPolicy,
            runningCount,
            maxConcurrent: this.deps.maxConcurrent,
          })
          return
        case 'replace':
          // Replace logic would stop running executions — for MVP, proceed
          log.warn('Concurrency replace policy selected but using proceed behavior (MVP)', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            runningCount,
            maxConcurrent: this.deps.maxConcurrent,
          })
          break
      }
    }

    await next()
  }
}
