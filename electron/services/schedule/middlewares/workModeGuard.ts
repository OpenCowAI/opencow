// SPDX-License-Identifier: Apache-2.0

import type { ExecutionContext, PipelineMiddleware } from '../../../../src/shared/types'
import type { BiweeklyCalculator } from '../biweeklyCalculator'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Schedule:WorkModeGuard')

export class WorkModeGuard implements PipelineMiddleware {
  readonly name = 'WorkModeGuard'

  constructor(
    private deps: {
      calculator: BiweeklyCalculator
    }
  ) {}

  async execute(ctx: ExecutionContext, next: () => Promise<void>): Promise<void> {
    const { schedule, trigger } = ctx

    // Manual triggers always bypass work-mode checks so the user gets
    // immediate feedback when clicking "Run Now".
    if (trigger.reason === 'manual') {
      log.debug('Work mode check bypassed for manual trigger', {
        scheduleId: schedule.id,
        executionId: ctx.execution.id,
      })
      await next()
      return
    }

    const frequency = schedule.trigger.time
    if (!frequency) {
      // Event-only trigger — no work mode check needed
      log.debug('Work mode check skipped for event-only trigger', {
        scheduleId: schedule.id,
        executionId: ctx.execution.id,
      })
      await next()
      return
    }

    const now = new Date()
    const { workMode } = frequency

    switch (workMode) {
      case 'all_days':
        // No restriction
        break

      case 'weekdays': {
        const day = now.getDay()
        if (day === 0 || day === 6) {
          ctx.skipped = true
          ctx.skipReason = `Non-workday (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day]})`
          log.info('Execution skipped by weekday work mode', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            day,
          })
          return
        }
        break
      }

      case 'big_small_week': {
        if (!frequency.biweeklyConfig) {
          // Fallback to weekdays if no config
          const day = now.getDay()
          if (day === 0 || day === 6) {
            ctx.skipped = true
            ctx.skipReason = 'Non-workday (biweekly config missing, fallback to weekdays)'
            log.info('Execution skipped by fallback weekday work mode', {
              scheduleId: schedule.id,
              executionId: ctx.execution.id,
              day,
            })
            return
          }
          break
        }
        if (!this.deps.calculator.isWorkday(now, frequency.biweeklyConfig)) {
          const isBig = this.deps.calculator.isBigWeek(now, frequency.biweeklyConfig)
          ctx.skipped = true
          ctx.skipReason = `Non-workday (${isBig ? 'big' : 'small'} week)`
          log.info('Execution skipped by biweekly work mode', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            isBigWeek: isBig,
          })
          return
        }
        break
      }
    }

    await next()
  }
}
