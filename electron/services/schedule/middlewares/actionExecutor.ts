// SPDX-License-Identifier: Apache-2.0

import type {
  ExecutionContext,
  PipelineMiddleware,
  SessionOrigin,
  StartSessionInput,
} from '../../../../src/shared/types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Schedule:ActionExecutor')

/** Minimal interface for session orchestration (avoids importing the full class) */
interface SessionOrchestratorLike {
  startSession(input: StartSessionInput): Promise<string>
  onSessionComplete(
    sessionId: string,
    callback: (result: { stopReason: string | null; error?: string }) => void
  ): void
}

/** Minimal interface for issue service */
interface IssueServiceLike {
  createIssue(input: {
    title: string
    description?: string
    projectId?: string | null
  }): Promise<{ id: string }>
}

/** Minimal interface for webhook dispatch */
interface WebhookServiceLike {
  dispatchEvent(event: string, payload: Record<string, unknown>): void
}

/** Minimal interface for inbox */
interface InboxServiceLike {
  createScheduleNotification(scheduleId: string, scheduleName: string, message: string): void
}

export class ActionExecutor implements PipelineMiddleware {
  readonly name = 'ActionExecutor'

  constructor(
    private deps: {
      sessionOrchestrator?: SessionOrchestratorLike
      issueService?: IssueServiceLike
      webhookService?: WebhookServiceLike
      inboxService?: InboxServiceLike
    }
  ) {}

  async execute(ctx: ExecutionContext, next: () => Promise<void>): Promise<void> {
    if (ctx.aborted || ctx.skipped) {
      await next()
      return
    }

    const { schedule, execution } = ctx
    const { action } = schedule
    log.info('Executing schedule action', {
      scheduleId: schedule.id,
      executionId: execution.id,
      actionType: action.type,
      projectId: action.projectId ?? null,
    })

    try {
      switch (action.type) {
        case 'start_session': {
          if (!this.deps.sessionOrchestrator) {
            throw new Error('SessionOrchestrator not available')
          }
          // Determine origin: if an issueId is explicitly linked, use issue origin
          // so the session appears in the Issue panel. Otherwise tag as schedule.
          const origin: SessionOrigin = action.issueId
            ? { source: 'issue', issueId: action.issueId }
            : { source: 'schedule', scheduleId: schedule.id }

          const input: StartSessionInput = {
            prompt: ctx.resolvedPrompt ?? action.session?.promptTemplate ?? '',
            origin,
            workspace: action.projectId
              ? { scope: 'project', projectId: action.projectId }
              : { scope: 'global' },
            model: action.session?.model,
            maxTurns: action.session?.maxTurns,
          }
          const sessionId = await this.deps.sessionOrchestrator.startSession(input)
          execution.sessionId = sessionId
          execution.status = 'running'
          log.info('Schedule action started managed session', {
            scheduleId: schedule.id,
            executionId: execution.id,
            sessionId,
          })
          break
        }

        case 'create_issue': {
          if (!this.deps.issueService) {
            throw new Error('IssueService not available')
          }
          const issue = await this.deps.issueService.createIssue({
            title: `[Schedule] ${schedule.name}`,
            description: ctx.resolvedPrompt ?? '',
            projectId: action.projectId ?? null,
          })
          execution.issueId = issue.id
          execution.status = 'success'
          log.info('Schedule action created issue', {
            scheduleId: schedule.id,
            executionId: execution.id,
            issueId: issue.id,
          })
          break
        }

        case 'webhook': {
          if (this.deps.webhookService) {
            this.deps.webhookService.dispatchEvent('schedule_execution', {
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              prompt: ctx.resolvedPrompt,
            })
            log.info('Schedule action dispatched webhook', {
              scheduleId: schedule.id,
              executionId: execution.id,
            })
          } else {
            log.warn('Schedule action webhook target unavailable', {
              scheduleId: schedule.id,
              executionId: execution.id,
            })
          }
          execution.status = 'success'
          break
        }

        case 'notification': {
          if (this.deps.inboxService) {
            this.deps.inboxService.createScheduleNotification(
              schedule.id,
              schedule.name,
              ctx.resolvedPrompt ?? 'Schedule triggered'
            )
            log.info('Schedule action created inbox notification', {
              scheduleId: schedule.id,
              executionId: execution.id,
            })
          } else {
            log.warn('Schedule action inbox target unavailable', {
              scheduleId: schedule.id,
              executionId: execution.id,
            })
          }
          execution.status = 'success'
          break
        }

        case 'resume_session': {
          // TODO: Implement resume_session action
          execution.status = 'success'
          log.warn('Schedule action resume_session is a placeholder and currently no-op', {
            scheduleId: schedule.id,
            executionId: execution.id,
          })
          break
        }

        default:
          throw new Error(`Unknown action type: ${action.type}`)
      }
    } catch (error) {
      execution.status = 'failed'
      execution.error = error instanceof Error ? error.message : String(error)
      ctx.aborted = true
      ctx.abortReason = execution.error
      log.error('Schedule action execution failed', {
        scheduleId: schedule.id,
        executionId: execution.id,
        actionType: action.type,
      }, error)
    }

    await next()
  }
}
