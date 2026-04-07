// SPDX-License-Identifier: Apache-2.0

import { createLogger } from '../../platform/logger'
import { ClaudeCodeAdapter } from '../../services/capabilityCenter/claudeCodeAdapter'
import type { ClaudeSessionLaunchOptionPatch, ClaudeSessionLaunchOptions } from '../sessionLaunchOptions'
import type { ClaudeEngineInjectionAdapter, ClaudeEngineInjectionRequest, EngineInjectionResult } from './types'

const log = createLogger('ClaudeInjectionAdapter')

export class ClaudeInjectionAdapter implements ClaudeEngineInjectionAdapter {
  readonly engineKind = 'claude' as const

  private readonly claudeAdapter = new ClaudeCodeAdapter()

  inject(request: ClaudeEngineInjectionRequest): EngineInjectionResult {
    const nextPromptLayers = { ...request.promptLayers }
    if (request.plan.agentPrompt) {
      nextPromptLayers.session = request.plan.agentPrompt
    }
    if (request.plan.capabilityPrompt) {
      nextPromptLayers.capability = request.plan.capabilityPrompt
    }

    const translated = this.claudeAdapter.translate(request.plan)

    let hooks = request.builtInHooks
    if (Object.keys(translated.hooks).length > 0) {
      hooks = ClaudeCodeAdapter.mergeHooks(request.builtInHooks ?? {}, translated.hooks)
    }

    const optionPatch: ClaudeSessionLaunchOptionPatch = {}
    if (Object.keys(translated.mcpServers).length > 0) {
      optionPatch.mcpServers = {
        ...(request.options.mcpServers ?? {}),
        ...translated.mcpServers,
      }
    }

    log.debug(
      `Injected Claude capabilities: hooks=${Object.keys(translated.hooks).length}, mcp=${Object.keys(translated.mcpServers).length}`,
    )

    return {
      promptLayers: nextPromptLayers,
      optionPatch,
      hooks,
      hookCleanup: translated.hookCleanup,
      activeMcpServerNames: translated.activeMcpServerNames,
    }
  }
}
