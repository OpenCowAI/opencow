// SPDX-License-Identifier: Apache-2.0

import type { ContextInjector, ContextInjectionType, Schedule } from '../../../../src/shared/types'
import type { ExecutionStore } from '../../executionStore'

export class LastResultInjector implements ContextInjector {
  readonly type: ContextInjectionType = 'last_execution_result'

  constructor(private executionStore: ExecutionStore) {}

  async inject(schedule: Schedule): Promise<string> {
    const executions = await this.executionStore.listBySchedule(schedule.id, 1)
    if (executions.length === 0) return '[No previous execution]'

    const last = executions[0]
    const parts = [
      `**Status:** ${last.status}`,
      `**Triggered:** ${new Date(last.startedAt).toISOString()}`,
    ]
    if (last.durationMs) parts.push(`**Duration:** ${Math.round(last.durationMs / 1000)}s`)
    if (last.error) parts.push(`**Error:** ${last.error}`)
    if (last.resolvedPrompt) {
      const preview = last.resolvedPrompt.slice(0, 500)
      parts.push(`**Prompt preview:** ${preview}${last.resolvedPrompt.length > 500 ? '...' : ''}`)
    }

    return parts.join('\n')
  }
}
