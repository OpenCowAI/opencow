// SPDX-License-Identifier: Apache-2.0

import type {
  ExecutionContext,
  ExecutionStatus,
  PipelineMiddleware,
  DataBusEvent,
} from '../../../../src/shared/types'
import type { ScheduleStore } from '../../scheduleStore'
import type { ExecutionStore } from '../../executionStore'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Schedule:ResultRecorder')

// ── Minimal interface ──────────────────────────────────────────────────────────
// Avoids importing the full SessionOrchestrator class (breaks circular deps).

interface SessionCompletionResult {
  stopReason: string | null
  error?: string
}

interface SessionOrchestratorLike {
  onSessionComplete(
    sessionId: string,
    callback: (result: SessionCompletionResult) => Promise<void> | void
  ): void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Map a session's terminal state to an ExecutionStatus.
 *
 * Priority: explicit error > stopReason mapping > unknown → failed.
 */
function mapToExecutionStatus(stopReason: string | null, error?: string): ExecutionStatus {
  if (error) return 'failed'
  switch (stopReason) {
    case 'completed':
    case 'max_turns':
      return 'success'
    case 'user_stopped':
      return 'cancelled'
    case null:
    case undefined:
      // lifecycle ended with no known stop reason (silent exit)
      return 'cancelled'
    default:
      // budget_exceeded | execution_error | structured_output_error | …
      return 'failed'
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────

export class ResultRecorder implements PipelineMiddleware {
  readonly name = 'ResultRecorder'

  constructor(
    private deps: {
      scheduleStore: ScheduleStore
      executionStore: ExecutionStore
      dispatch: (event: DataBusEvent) => void
      /** Required for session-backed executions to receive completion events. */
      sessionOrchestrator?: SessionOrchestratorLike
    }
  ) {}

  async execute(ctx: ExecutionContext, next: () => Promise<void>): Promise<void> {
    // Let all upstream middlewares (ActionExecutor, etc.) run first
    await next()

    const { schedule, execution } = ctx
    const now = Date.now()

    // Finalise terminal executions (non-session actions complete synchronously)
    if (ctx.skipped) {
      execution.status = 'skipped'
      execution.error = ctx.skipReason ?? null
    }

    if (execution.status !== 'running') {
      execution.completedAt = now
      execution.durationMs = now - execution.startedAt
    }

    // Persist the execution record
    execution.resolvedPrompt = ctx.resolvedPrompt ?? null
    await this.deps.executionStore.add(execution)
    log.info('Execution record persisted', {
      scheduleId: schedule.id,
      executionId: execution.id,
      status: execution.status,
      sessionId: execution.sessionId,
      issueId: execution.issueId,
    })

    // Update schedule aggregate stats
    const runStatus =
      execution.status === 'success' || execution.status === 'running'
        ? 'success'
        : execution.status === 'skipped'
          ? 'skipped'
          : 'failed'
    await this.deps.scheduleStore.incrementExecution(schedule.id, runStatus)
    log.debug('Schedule aggregate counters updated', {
      scheduleId: schedule.id,
      executionId: execution.id,
      runStatus,
    })

    // Dispatch initial event so the renderer can show the running indicator
    this.deps.dispatch({
      type: 'schedule:executed',
      payload: { scheduleId: schedule.id, execution },
    })

    // ── Session-backed execution: register lifecycle completion callback ────────
    //
    // For `start_session` actions the session runs asynchronously in the
    // background.  We cannot rely on the DataBus event chain (`command:session:idle`)
    // because it is only dispatched when the SDK sends a `result` message —
    // silent exits, transient spawn errors, and audit-recovered sessions never
    // dispatch that event.
    //
    // Instead, SessionOrchestrator.lifecycleDone ALWAYS resolves when the
    // session ends (success, error, or silent exit).  We hook into it here via
    // onSessionComplete so we can update the execution record with the true
    // final status immediately after the session lifecycle settles.
    //
    if (execution.status === 'running' && execution.sessionId && this.deps.sessionOrchestrator) {
      const execId = execution.id
      const sessionId = execution.sessionId
      const scheduleId = schedule.id

      this.deps.sessionOrchestrator.onSessionComplete(sessionId, async ({ stopReason, error }) => {
        const finalStatus = mapToExecutionStatus(stopReason, error)
        const completedAt = Date.now()

        await this.deps.executionStore.updateStatus(execId, finalStatus, completedAt, error ?? null)
        log.info('Execution status updated from session completion callback', {
          scheduleId,
          executionId: execId,
          sessionId,
          stopReason,
          finalStatus,
        })

        // Re-fetch to get the duration_ms computed by updateStatus
        const updated = await this.deps.executionStore.get(execId)
        if (updated) {
          this.deps.dispatch({
            type: 'schedule:executed',
            payload: { scheduleId, execution: updated },
          })
        } else {
          log.warn('Execution update callback could not find execution after status update', {
            scheduleId,
            executionId: execId,
            sessionId,
          })
        }
      })
    }
  }
}
