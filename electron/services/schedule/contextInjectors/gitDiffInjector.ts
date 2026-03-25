// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ContextInjector, ContextInjectionType, Schedule } from '../../../../src/shared/types'
import { createLogger } from '../../../platform/logger'

const execFileAsync = promisify(execFile)
const log = createLogger('Schedule:GitDiffInjector')

/** Minimal interface for project resolution */
interface ProjectStoreLike {
  getById(id: string): Promise<{ canonicalPath: string } | null>
}

export class GitDiffInjector implements ContextInjector {
  readonly type: ContextInjectionType = 'git_diff_24h'

  constructor(private deps: { projectStore?: ProjectStoreLike }) {}

  async inject(schedule: Schedule): Promise<string> {
    const cwd = await this.resolveProjectPath(schedule.action.projectId)
    if (!cwd) return '[No project path configured]'

    try {
      const { stdout: diffStat } = await execFileAsync(
        'git',
        ['diff', '--stat', 'HEAD~1'],
        { cwd, timeout: 10_000 }
      )

      const { stdout: logOutput } = await execFileAsync(
        'git',
        ['log', '--oneline', '--since=24 hours ago', '-20'],
        { cwd, timeout: 10_000 }
      )

      const parts: string[] = []
      if (diffStat.trim()) parts.push(`**Diff stat:**\n\`\`\`\n${diffStat.trim()}\n\`\`\``)
      if (logOutput.trim()) parts.push(`**Recent commits:**\n\`\`\`\n${logOutput.trim()}\n\`\`\``)

      return parts.length > 0 ? parts.join('\n\n') : '[No changes in last 24h]'
    } catch (err) {
      log.warn('GitDiffInjector failed; returning fallback context', {
        scheduleId: schedule.id,
        projectId: schedule.action.projectId ?? null,
      }, err)
      return '[Git not available or not a git repository]'
    }
  }

  private async resolveProjectPath(projectId: string | undefined): Promise<string | undefined> {
    if (!projectId || !this.deps.projectStore) return undefined
    const project = await this.deps.projectStore.getById(projectId)
    return project?.canonicalPath
  }
}
