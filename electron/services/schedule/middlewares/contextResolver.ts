// SPDX-License-Identifier: Apache-2.0

import type {
  ExecutionContext,
  PipelineMiddleware,
  ContextInjector,
  ContextInjectionType,
  Schedule,
} from '../../../../src/shared/types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Schedule:ContextResolver')

/** Minimal interface for project resolution */
interface ProjectStoreLike {
  getById(id: string): Promise<{ name: string; canonicalPath: string } | null>
}

/** Resolved project metadata for template variable substitution. */
interface ResolvedProject {
  name: string
  path: string
}

/** Built-in template variables */
async function resolveTemplateVariables(
  template: string,
  schedule: Schedule,
  project: ResolvedProject | null
): Promise<string> {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  const vars: Record<string, string> = {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    datetime: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    weekday: weekdays[now.getDay()],
    project: project?.name ?? 'unknown',
    project_path: project?.path ?? '',
    run_count: String(schedule.executionCount + 1),
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match)
}

export class ContextResolver implements PipelineMiddleware {
  readonly name = 'ContextResolver'

  constructor(
    private deps: {
      injectors: Map<ContextInjectionType, ContextInjector>
      projectStore?: ProjectStoreLike
    }
  ) {}

  async execute(ctx: ExecutionContext, next: () => Promise<void>): Promise<void> {
    if (ctx.aborted || ctx.skipped) {
      await next()
      return
    }

    const { schedule } = ctx
    const promptTemplate = schedule.action.session?.promptTemplate ?? ''

    // Resolve project metadata for template variables
    const project = await this.resolveProject(schedule.action.projectId)

    // Step 1: Resolve template variables
    let resolvedPrompt = await resolveTemplateVariables(promptTemplate, schedule, project)

    // Step 2: Dynamic context injection
    const injections = schedule.action.contextInjections ?? []
    if (injections.length > 0) {
      const contextParts: string[] = []
      const appliedInjectors: string[] = []

      for (const injectionType of injections) {
        const injector = this.deps.injectors.get(injectionType)
        if (!injector) {
          log.warn('Context injector not found', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            injectionType,
          })
          continue
        }
        try {
          const content = await injector.inject(schedule)
          if (content.trim()) {
            contextParts.push(`### ${injectionType}\n${content}`)
            appliedInjectors.push(injectionType)
          }
        } catch (err) {
          contextParts.push(`### ${injectionType}\n[Error: failed to inject context]`)
          log.error('Context injection failed', {
            scheduleId: schedule.id,
            executionId: ctx.execution.id,
            injectionType,
          }, err)
        }
      }

      if (contextParts.length > 0) {
        resolvedPrompt += `\n\n---\n## Context\n\n${contextParts.join('\n\n')}`
        log.debug('Dynamic context injected', {
          scheduleId: schedule.id,
          executionId: ctx.execution.id,
          requestedInjectors: injections,
          appliedInjectors,
        })
      }
    }

    ctx.resolvedPrompt = resolvedPrompt
    ctx.injectedContext = {}
    log.debug('Context resolved for execution', {
      scheduleId: schedule.id,
      executionId: ctx.execution.id,
      projectId: schedule.action.projectId ?? null,
      promptLength: resolvedPrompt.length,
    })
    await next()
  }

  private async resolveProject(projectId: string | undefined): Promise<ResolvedProject | null> {
    if (!projectId || !this.deps.projectStore) return null
    const project = await this.deps.projectStore.getById(projectId)
    if (!project) return null
    return { name: project.name, path: project.canonicalPath }
  }
}
