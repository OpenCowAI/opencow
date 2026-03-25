// SPDX-License-Identifier: Apache-2.0

import os from 'node:os'
import path from 'node:path'

export type CodexScope = 'global' | 'project'

export function resolveCodexConfigPath(params: {
  scope: CodexScope
  projectPath?: string
}): string {
  if (params.scope === 'project') {
    if (!params.projectPath) {
      throw new Error('projectPath is required for codex project scope')
    }
    return path.join(params.projectPath, '.codex', 'config.toml')
  }
  return path.join(os.homedir(), '.codex', 'config.toml')
}

export function resolveCodexSkillsDir(params: {
  scope: CodexScope
  projectPath?: string
}): string {
  if (params.scope === 'project') {
    if (!params.projectPath) {
      throw new Error('projectPath is required for codex project scope')
    }
    return path.join(params.projectPath, '.agents', 'skills')
  }
  return path.join(os.homedir(), '.agents', 'skills')
}

export function resolveCodexSkillFilePath(params: {
  scope: CodexScope
  name: string
  projectPath?: string
}): string {
  return path.join(
    resolveCodexSkillsDir({ scope: params.scope, projectPath: params.projectPath }),
    params.name,
    'SKILL.md',
  )
}
