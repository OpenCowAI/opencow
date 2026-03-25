// SPDX-License-Identifier: Apache-2.0

import type { AIEngineKind, StartSessionNativeToolAllowItem } from '../../src/shared/types'
import { createLogger } from '../platform/logger'
import type { CapabilityCenter, CapabilityPlanRequest } from '../services/capabilityCenter'
import type { SDKHookMap } from '../services/capabilityCenter/claudeCodeAdapter'
import type { SystemPromptLayers } from './systemPromptComposer'
import type { SessionLaunchOptions } from './sessionLaunchOptions'
import { ClaudeInjectionAdapter } from './injection/claudeInjectionAdapter'
import { CodexInjectionAdapter } from './injection/codexInjectionAdapter'
import type { EngineInjectionAdapter } from './injection/types'

const log = createLogger('EngineCapabilityRuntime')
const CODEX_PROMPT_SIZE_WARN_CHARS = 30_000

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
  optionPatch: Partial<SessionLaunchOptions>
  hooks?: SDKHookMap
  hookCleanup?: () => void
  activeMcpServerNames?: ReadonlySet<string>
  /** Native tool requirements self-declared by activated skills via `metadata.nativeRequirements`. */
  nativeRequirements?: StartSessionNativeToolAllowItem[]
}

interface EngineCapabilityRuntimeDeps {
  capabilityCenter?: CapabilityCenter
  adapters?: EngineInjectionAdapter[]
}

export class EngineCapabilityRuntime {
  private readonly capabilityCenter?: CapabilityCenter
  private readonly adapters = new Map<AIEngineKind, EngineInjectionAdapter>()

  constructor(deps: EngineCapabilityRuntimeDeps) {
    this.capabilityCenter = deps.capabilityCenter

    const adapters = deps.adapters ?? [new ClaudeInjectionAdapter(), new CodexInjectionAdapter()]
    for (const adapter of adapters) {
      this.adapters.set(adapter.engineKind, adapter)
    }
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

    const adapter = this.adapters.get(input.engineKind)
    if (!adapter) {
      log.warn(`No injection adapter for engine=${input.engineKind}; skipping capability injection`)
      return fallback
    }

    try {
      const plan = await this.capabilityCenter.buildCapabilityPlan(input.planInput)
      if (input.engineKind === 'codex' && plan.totalChars > CODEX_PROMPT_SIZE_WARN_CHARS) {
        log.warn(
          `Codex capability prompt is large (${plan.totalChars} chars) and may impact responsiveness`,
        )
      }
      const output = adapter.inject({
        engineKind: input.engineKind,
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
      log.error(`Capability injection failed for engine=${input.engineKind}`, err)
      return fallback
    }
  }
}
