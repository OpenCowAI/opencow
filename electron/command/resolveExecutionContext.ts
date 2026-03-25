// SPDX-License-Identifier: Apache-2.0

import type { SessionExecutionContext } from '../../src/shared/types'
import type { GitCommandExecutor } from '../services/git/gitCommandExecutor'

/**
 * Resolve the full execution context for a given working directory.
 * Queries git status to populate branch, detached, and worktree information.
 *
 * Uses GitCommandExecutor (stateless) rather than GitService (project-centric)
 * because the cwd may be an arbitrary directory not yet activated as a project.
 */
export async function resolveExecutionContext(
  cwd: string,
  projectPath: string | null,
  gitExecutor: GitCommandExecutor | null,
): Promise<SessionExecutionContext> {
  let gitBranch: string | null = null
  let isDetached = false

  if (gitExecutor) {
    try {
      const isRepo = await gitExecutor.isGitRepo(cwd)
      if (isRepo) {
        const status = await gitExecutor.getStatus(cwd)
        gitBranch = status.branch
        isDetached = status.isDetached
      }
    } catch {
      // Git query failure is non-fatal — proceed with null branch
    }
  }

  return {
    cwd,
    gitBranch,
    isDetached,
    isWorktree: detectWorktree(cwd, projectPath),
    updatedAt: Date.now(),
  }
}

/**
 * Determine whether `cwd` represents a worktree by comparing it to `projectPath`.
 *
 * A session is considered to be in a worktree when its cwd is a completely
 * different directory tree from the project root — not just a subdirectory.
 */
function detectWorktree(cwd: string, projectPath: string | null): boolean {
  if (!projectPath) return false
  if (cwd === projectPath) return false
  // cwd is a child of projectPath → agent just cd'd into a subdirectory
  if (cwd.startsWith(projectPath + '/')) return false
  // cwd is in a completely different tree → worktree or external directory
  return true
}
