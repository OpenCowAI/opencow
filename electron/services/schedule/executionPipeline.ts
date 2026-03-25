// SPDX-License-Identifier: Apache-2.0

import type { ExecutionContext, PipelineMiddleware } from '../../../src/shared/types'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleExecutionPipeline')

export class ExecutionPipeline {
  private middlewares: PipelineMiddleware[] = []

  use(middleware: PipelineMiddleware): this {
    this.middlewares.push(middleware)
    return this
  }

  async run(ctx: ExecutionContext): Promise<ExecutionContext> {
    const startedAt = Date.now()
    log.debug('Execution pipeline run started', {
      scheduleId: ctx.schedule.id,
      executionId: ctx.execution.id,
      middlewareCount: this.middlewares.length,
    })
    await this.runAt(ctx, 0)
    log.debug('Execution pipeline run finished', {
      scheduleId: ctx.schedule.id,
      executionId: ctx.execution.id,
      durationMs: Date.now() - startedAt,
      status: ctx.execution.status,
      skipped: ctx.skipped,
      aborted: ctx.aborted,
    })
    return ctx
  }

  private async runAt(ctx: ExecutionContext, index: number): Promise<void> {
    if (index >= this.middlewares.length) return
    const middleware = this.middlewares[index]
    const middlewareName = (middleware as { name?: string }).name ?? `middleware#${index}`
    const startedAt = Date.now()
    try {
      await middleware.execute(ctx, async () => {
        await this.runAt(ctx, index + 1)
      })
      log.debug('Execution pipeline middleware completed', {
        scheduleId: ctx.schedule.id,
        executionId: ctx.execution.id,
        middleware: middlewareName,
        durationMs: Date.now() - startedAt,
        status: ctx.execution.status,
        skipped: ctx.skipped,
        aborted: ctx.aborted,
      })
    } catch (err) {
      log.error('Execution pipeline middleware failed', {
        scheduleId: ctx.schedule.id,
        executionId: ctx.execution.id,
        middleware: middlewareName,
        durationMs: Date.now() - startedAt,
      }, err)
      throw err
    }
  }
}
