// SPDX-License-Identifier: Apache-2.0

export type ClaudeCodeDistributionTargetType = 'claude-code-global' | 'claude-code-project'
export type CapabilityDistributionTargetType = ClaudeCodeDistributionTargetType

export function resolveDistributionTargetType(params: {
  engineKind: 'claude'
  scope: 'global' | 'project'
}): ClaudeCodeDistributionTargetType {
  return params.scope === 'project' ? 'claude-code-project' : 'claude-code-global'
}

export function targetTypesForEngine(_engineKind: 'claude'): CapabilityDistributionTargetType[] {
  return ['claude-code-global', 'claude-code-project']
}

export function isClaudeCodeTargetType(
  targetType: string,
): targetType is ClaudeCodeDistributionTargetType {
  return targetType === 'claude-code-global' || targetType === 'claude-code-project'
}
