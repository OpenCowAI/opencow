// SPDX-License-Identifier: Apache-2.0

import type { ContextInjector, ContextInjectionType, Schedule, Issue } from '../../../../src/shared/types'
import { createLogger } from '../../../platform/logger'

const log = createLogger('Schedule:IssuesInjector')

interface IssueQueryLike {
  list(filter?: { projectId?: string; status?: string }): Promise<Issue[]>
}

export class IssuesInjector implements ContextInjector {
  readonly type: ContextInjectionType = 'open_issues'

  constructor(private issueQuery: IssueQueryLike) {}

  async inject(schedule: Schedule): Promise<string> {
    try {
      const issues = await this.issueQuery.list({
        projectId: schedule.action.projectId ?? undefined,
      })

      const openIssues = issues.filter(
        (i) => i.status !== 'done' && i.status !== 'cancelled'
      )

      if (openIssues.length === 0) return '[No open issues]'

      const lines = openIssues
        .slice(0, 20)
        .map((i) => `- [${i.priority}] ${i.title} (${i.status})`)

      return `**Open issues (${openIssues.length}):**\n${lines.join('\n')}`
    } catch (err) {
      log.warn('IssuesInjector failed; returning fallback context', {
        scheduleId: schedule.id,
        projectId: schedule.action.projectId ?? null,
      }, err)
      return '[Failed to fetch issues]'
    }
  }
}
