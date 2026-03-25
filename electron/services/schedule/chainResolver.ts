// SPDX-License-Identifier: Apache-2.0

import type {
  ExecutionContext,
  TriggerEvent,
  SchedulePipeline,
  StepCondition,
  ExecutionStatus,
} from '../../../src/shared/types'
import type { PipelineStore } from '../pipelineStore'
import { createLogger } from '../../platform/logger'

const log = createLogger('ScheduleChainResolver')

export class ChainResolver {
  constructor(
    private deps: {
      pipelineStore: PipelineStore
      onTrigger: (event: TriggerEvent) => void
    }
  ) {}

  async handleResult(ctx: ExecutionContext): Promise<void> {
    const { execution } = ctx
    if (!execution.pipelineId) return

    const pipeline = await this.deps.pipelineStore.get(execution.pipelineId)
    if (!pipeline) {
      log.warn('Chain resolver skipped because pipeline was not found', {
        pipelineId: execution.pipelineId,
        executionId: execution.id,
      })
      return
    }
    if (pipeline.status !== 'active') {
      log.debug('Chain resolver skipped because pipeline is not active', {
        pipelineId: pipeline.id,
        status: pipeline.status,
      })
      return
    }

    const currentStepOrder = execution.pipelineStepOrder ?? 0
    const nextStep = pipeline.steps.find((s) => s.order === currentStepOrder + 1)
    if (!nextStep) {
      log.info('Chain pipeline finished', {
        pipelineId: pipeline.id,
        executionId: execution.id,
        lastStepOrder: currentStepOrder,
      })
      return
    }

    // Evaluate step condition
    if (!this.evaluateCondition(nextStep.condition, execution.status)) {
      // Condition not met — check pipeline failure policy
      if (pipeline.failurePolicy === 'stop_chain') {
        log.info('Chain resolver stopped due to unmet step condition', {
          pipelineId: pipeline.id,
          stepOrder: nextStep.order,
          executionStatus: execution.status,
          failurePolicy: pipeline.failurePolicy,
        })
        return
      }

      if (pipeline.failurePolicy === 'skip_step') {
        // Try the step after next
        const skipStep = pipeline.steps.find((s) => s.order === currentStepOrder + 2)
        if (skipStep && this.evaluateCondition(skipStep.condition, execution.status)) {
          log.info('Chain resolver skipping one step due to policy', {
            pipelineId: pipeline.id,
            fromStepOrder: currentStepOrder + 1,
            toStepOrder: skipStep.order,
            executionStatus: execution.status,
          })
          this.triggerStep(skipStep.scheduleId, pipeline, skipStep.order)
        }
        return
      }

      // retry_step — re-trigger the same step (handled by RetryScheduler)
      log.info('Chain resolver defers to retry policy on unmet condition', {
        pipelineId: pipeline.id,
        stepOrder: nextStep.order,
        executionStatus: execution.status,
      })
      return
    }

    log.info('Chain resolver triggered next step', {
      pipelineId: pipeline.id,
      stepOrder: nextStep.order,
      scheduleId: nextStep.scheduleId,
    })
    this.triggerStep(nextStep.scheduleId, pipeline, nextStep.order)
  }

  private evaluateCondition(condition: StepCondition, status: ExecutionStatus): boolean {
    switch (condition.type) {
      case 'always':
        return true
      case 'previous_success':
        return status === 'success'
      case 'previous_failure':
        return status === 'failed'
      case 'previous_status':
        return status === condition.status
      default:
        return false
    }
  }

  private triggerStep(
    scheduleId: string,
    pipeline: SchedulePipeline,
    stepOrder: number
  ): void {
    this.deps.onTrigger({
      scheduleId,
      reason: 'chain',
      timestamp: Date.now(),
      pipelineId: pipeline.id,
      pipelineStepOrder: stepOrder,
    })
  }
}
