// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind, StartSessionNativeToolAllowItem } from '../../src/shared/types'
import { createLogger } from '../platform/logger'
import type { CapabilityCenter, CapabilityPlanRequest } from '../services/capabilityCenter'
import type { SDKHookMap } from '../services/capabilityCenter/claudeCodeAdapter'
import type { SystemPromptLayers } from './systemPromptComposer'
import type { SessionLaunchOptions, SessionLaunchOptionPatch } from './sessionLaunchOptions'
import { ClaudeInjectionAdapter } from './injection/claudeInjectionAdapter'
import type { ClaudeEngineInjectionAdapter } from './injection/types'

const log = createLogger('EngineCapabilityRuntime')
interface CapabilityPlanInput {
  projectId?: string
  request: CapabilityPlanRequest
}

export interface EngineCapabilityRuntimeInput {
  engineKind: AIEngineKind
  planInput: CapabilityPlanInput
  promptLayers: SystemPromptLayers
  options: SessionLaunchOptions
  builtInHooks?: SDKHookMap
}

export interface EngineCapabilityRuntimeOutput {
  promptLayers: SystemPromptLayers
  optionPatch: SessionLaunchOptionPatch
  hooks?: SDKHookMap
  hookCleanup?: () => void
  activeMcpServerNames?: ReadonlySet<string>
  /** Native tool requirements self-declared by activated skills via `metadata.nativeRequirements`. */
  nativeRequirements?: StartSessionNativeToolAllowItem[]
}

interface EngineCapabilityRuntimeDeps {
  capabilityCenter?: CapabilityCenter
  claudeAdapter?: ClaudeEngineInjectionAdapter
}

export class EngineCapabilityRuntime {
  private readonly capabilityCenter?: CapabilityCenter
  private readonly claudeAdapter: ClaudeEngineInjectionAdapter

  private static isInvariantError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    return err.message.startsWith('Capability injection engine mismatch:')
  }

  constructor(deps: EngineCapabilityRuntimeDeps) {
    this.capabilityCenter = deps.capabilityCenter
    this.claudeAdapter = deps.claudeAdapter ?? new ClaudeInjectionAdapter()
  }

  async apply(input: EngineCapabilityRuntimeInput): Promise<EngineCapabilityRuntimeOutput> {
    const fallback: EngineCapabilityRuntimeOutput = {
      promptLayers: { ...input.promptLayers },
      optionPatch: {},
      hooks: input.builtInHooks,
    }

    if (!this.capabilityCenter) {
      return fallback
    }

    try {
      const plan = await this.capabilityCenter.buildCapabilityPlan(input.planInput)
      if (input.options.engineKind !== input.engineKind) {
        throw new Error(
          `Capability injection engine mismatch: runtime=${input.engineKind}, options=${input.options.engineKind}`,
        )
      }

      const output = this.claudeAdapter.inject({
        engineKind: 'claude',
        plan,
        promptLayers: input.promptLayers,
        options: input.options,
        builtInHooks: input.builtInHooks,
      })

      log.info(
        `Capability injection (${input.engineKind}): ${plan.summary.skills.length} skills, ` +
        `agent=${plan.summary.agent ?? 'none'}, ${plan.summary.rules.length} rules, ` +
        `${plan.summary.hooks.length} hooks, ${plan.summary.mcpServers.length} MCP servers` +
        (plan.summary.mcpServers.length > 0 ? ` [${plan.summary.mcpServers.join(', ')}]` : '') +
        `, ${plan.summary.skippedDistributed.length} skipped (distributed), ` +
        `${plan.summary.skippedByBudget.length} skipped (budget), ${plan.totalChars} chars` +
        (plan.nativeRequirements.length > 0
          ? `, ${plan.nativeRequirements.length} native requirements [${plan.nativeRequirements.map((r) => r.capability).join(', ')}]`
          : ''),
      )

      return {
        ...output,
        nativeRequirements: plan.nativeRequirements.length > 0 ? plan.nativeRequirements : undefined,
      }
    } catch (err) {
      if (EngineCapabilityRuntime.isInvariantError(err)) {
        throw err
      }
      log.error(`Capability injection failed for engine=${input.engineKind}`, err)
      return fallback
    }
  }
}
