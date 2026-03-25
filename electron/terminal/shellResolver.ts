// SPDX-License-Identifier: Apache-2.0

import { homedir } from 'os'
import { existsSync } from 'fs'
import type { TerminalScope } from '@shared/types'

/**
 * Resolve the default shell path for the current platform.
 *
 * Priority:
 * 1. SHELL environment variable (macOS / Linux)
 * 2. ComSpec environment variable (Windows)
 * 3. Platform fallback
 */
export function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe'
  }

  const shell = process.env.SHELL
  if (shell && existsSync(shell)) return shell

  // macOS / Linux fallback
  return '/bin/zsh'
}

/**
 * Resolve the working directory based on TerminalScope.
 *
 * @param scope   - Terminal ownership identifier
 * @param resolve - Project ID to path resolver function (obtained from ProjectService)
 */
export function resolveCwd(
  scope: TerminalScope,
  resolveProjectPath: (projectId: string) => string | null,
): string {
  if (scope.type === 'global') {
    return homedir()
  }

  const projectPath = resolveProjectPath(scope.projectId)
  if (projectPath && existsSync(projectPath)) {
    return projectPath
  }

  // Fallback: use home when project path does not exist
  return homedir()
}
