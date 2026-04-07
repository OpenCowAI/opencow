// SPDX-License-Identifier: Apache-2.0

import { createLogger } from '../../platform/logger'
import type { CodexEngineInjectionAdapter, CodexEngineInjectionRequest, EngineInjectionResult } from './types'
import type { CodexSessionLaunchOptionPatch } from '../sessionLaunchOptions'
import { mergeCodexMcpServers } from '../codexMcpConfigBuilder'

const log = createLogger('CodexInjectionAdapter')

export class CodexInjectionAdapter implements CodexEngineInjectionAdapter {
  readonly engineKind = 'codex' as const

  inject(request: CodexEngineInjectionRequest): EngineInjectionResult {
    const nextPromptLayers = { ...request.promptLayers }
    if (request.plan.agentPrompt) {
      nextPromptLayers.session = request.plan.agentPrompt
    }
    if (request.plan.capabilityPrompt) {
      nextPromptLayers.capability = request.plan.capabilityPrompt
    }

    const skippedHookCount = Object.keys(request.plan.declarativeHooks).length
    if (skippedHookCount > 0) {
      log.debug(
        `Codex capability injection skipped hooks=${skippedHookCount} (not supported by Codex SDK runtime path)`,
      )
    }

    const mcpServerEntries = Object.entries(request.plan.mcpServers)
    const optionPatch: CodexSessionLaunchOptionPatch = {}
    let activeMcpServerNames: ReadonlySet<string> | undefined
    if (mcpServerEntries.length > 0) {
      const merged = mergeCodexMcpServers({
        baseConfig: request.options.codexConfig,
        overlays: [request.plan.mcpServers],
      })
      if (merged.config) optionPatch.codexConfig = merged.config
      if (merged.activeServerNames.size > 0) activeMcpServerNames = merged.activeServerNames

      log.debug(
        `Codex capability injection mapped ${mcpServerEntries.length} MCP server(s) into codexConfig.mcp_servers`,
      )
    }

    return {
      promptLayers: nextPromptLayers,
      optionPatch,
      activeMcpServerNames,
    }
  }
}
