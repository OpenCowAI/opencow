// SPDX-License-Identifier: Apache-2.0

/**
 * SDK AgentDefinition adapter — converts OpenCow's `DocumentCapabilityEntry`
 * (category: 'agent') into the SDK's internal `AgentDefinition` shape so the
 * SDK's built-in AgentTool can list, describe, and dispatch them.
 *
 * Same rationale as `sdkCommandAdapter.ts` — OpenCow scans & manages agents
 * via its own CapabilityCenter pipeline; this adapter bridges the gap so the
 * model can call `Agent({ subagent_type: 'name', prompt: '...' })`.
 *
 * ## Phase 1B.11d
 */

import type { DocumentCapabilityEntry } from '@shared/types'

/**
 * Minimal shape of the SDK's `CustomAgentDefinition` that AgentTool can consume.
 *
 * We do NOT import the SDK's `AgentDefinition` to avoid pulling in CLI-internal
 * types. The SDK casts `options.agents: unknown[]` to `AgentDefinition[]` at
 * runtime; we produce structurally-compatible objects.
 */
interface SdkAgentDefinitionShape {
  agentType: string
  whenToUse: string
  source: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  model?: string
  effort?: string | number
  maxTurns?: number
  background?: boolean
  getSystemPrompt: () => string
}

/**
 * Convert an OpenCow `DocumentCapabilityEntry` (category: 'agent') into an
 * SDK-compatible `AgentDefinition` shape.
 */
export function toSdkAgentDefinition(entry: DocumentCapabilityEntry): SdkAgentDefinitionShape {
  const metadata = entry.metadata ?? {}

  return {
    agentType: entry.name,
    whenToUse: entry.description || `Agent: ${entry.name}`,
    source: entry.scope === 'project' ? 'projectSettings' : 'userSettings',
    tools: asOptionalStringArray(metadata['tools']),
    disallowedTools: asOptionalStringArray(metadata['disallowedTools']),
    skills: asOptionalStringArray(metadata['skills']),
    model: asOptionalString(metadata['model']),
    effort: metadata['effort'] as string | number | undefined,
    maxTurns: typeof metadata['maxTurns'] === 'number' ? metadata['maxTurns'] : undefined,
    background: metadata['background'] === true ? true : undefined,

    // The agent's system prompt IS the markdown body.
    getSystemPrompt: () => entry.body,
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asOptionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((v): v is string => typeof v === 'string')
  return strings.length > 0 ? strings : undefined
}
