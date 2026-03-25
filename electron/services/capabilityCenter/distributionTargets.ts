// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind } from '@shared/types'

export type ClaudeCodeDistributionTargetType = 'claude-code-global' | 'claude-code-project'
export type CodexDistributionTargetType = 'codex-global' | 'codex-project'
export type CapabilityDistributionTargetType =
  | ClaudeCodeDistributionTargetType
  | CodexDistributionTargetType

export function resolveDistributionTargetType(params: {
  engineKind: 'claude'
  scope: 'global' | 'project'
}): ClaudeCodeDistributionTargetType
export function resolveDistributionTargetType(params: {
  engineKind: 'codex'
  scope: 'global' | 'project'
}): CodexDistributionTargetType
export function resolveDistributionTargetType(params: {
  engineKind: AIEngineKind
  scope: 'global' | 'project'
}): CapabilityDistributionTargetType {
  if (params.engineKind === 'codex') {
    return params.scope === 'project' ? 'codex-project' : 'codex-global'
  }
  return params.scope === 'project' ? 'claude-code-project' : 'claude-code-global'
}

export function targetTypesForEngine(engineKind: AIEngineKind): CapabilityDistributionTargetType[] {
  if (engineKind === 'codex') {
    return ['codex-global', 'codex-project']
  }
  return ['claude-code-global', 'claude-code-project']
}

export function isClaudeCodeTargetType(
  targetType: string,
): targetType is ClaudeCodeDistributionTargetType {
  return targetType === 'claude-code-global' || targetType === 'claude-code-project'
}

export function isCodexTargetType(
  targetType: string,
): targetType is CodexDistributionTargetType {
  return targetType === 'codex-global' || targetType === 'codex-project'
}
