// SPDX-License-Identifier: Apache-2.0

/**
 * SessionLaunchOptions — strongly-typed options bag for the session launch
 * pipeline. At the SDK boundary (`lifecycle.start()`), the typed object is
 * converted to `Record<string, unknown>` via `toSdkOptions()`.
 */

import type { SpawnOptions, SpawnedProcess } from '@opencow-ai/opencow-agent-sdk'
import type { RuntimeCanUseTool } from './enginePolicy'
import type { SDKHookMap } from '../services/capabilityCenter/claudeCodeAdapter'
import type {
  ProviderNativeSystemPrompt,
  SystemPromptTransportPayload,
} from './systemPromptTransport'

// ── Main type ───────────────────────────────────────────────────────────────

export interface SessionLaunchOptions {
  maxTurns: number
  includePartialMessages: boolean
  permissionMode: string
  allowDangerouslySkipPermissions: boolean
  env: Record<string, string>
  cwd?: string
  resume?: string
  model?: string
  systemPromptPayload: ProviderNativeSystemPrompt
  initialMessages?: unknown[]
  pathToClaudeCodeExecutable?: string
  spawnClaudeCodeProcess?: (opts: SpawnOptions) => SpawnedProcess
  tools?: unknown[]
  disallowedTools?: string[]
  canUseTool?: RuntimeCanUseTool
  mcpServers?: Record<string, unknown>
  hooks?: SDKHookMap
  /**
   * Phase 1B.11d — host-provided skill commands for SDK's built-in SkillTool.
   */
  commands?: unknown[]
  /**
   * Phase 1B.11d — host-provided agent definitions for SDK's built-in AgentTool.
   */
  agents?: unknown[]
}

// Keep the old name as an alias during migration (some files import it)
export type ClaudeSessionLaunchOptions = SessionLaunchOptions

/**
 * Capability-injection option patch. Produced by engine-specific injection
 * adapters and merged into the launch options during orchestrator pre-flight.
 */
export interface SessionLaunchOptionPatch {
  mcpServers?: Record<string, unknown>
}

// Keep the old name as an alias during migration
export type ClaudeSessionLaunchOptionPatch = SessionLaunchOptionPatch

/**
 * Apply engine-scoped patch fields into typed launch options.
 */
export function applySessionLaunchOptionPatch(
  options: SessionLaunchOptions,
  patch: SessionLaunchOptionPatch,
): void {
  if (Object.keys(patch).length === 0) return

  if (patch.mcpServers && Object.keys(patch.mcpServers).length > 0) {
    options.mcpServers = {
      ...(options.mcpServers ?? {}),
      ...patch.mcpServers,
    }
  }
}

// ── SDK boundary conversion ─────────────────────────────────────────────────

/**
 * Convert the typed SessionLaunchOptions to the untyped Record<string, unknown>
 * required by the SDK's `lifecycle.start()` and `sdkQuery()`.
 */
export function toSdkOptions(options: SessionLaunchOptions): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...options }

  const payload = options.systemPromptPayload as SystemPromptTransportPayload | undefined
  if (
    !payload
    || typeof payload !== 'object'
    || typeof payload.transport !== 'string'
    || typeof payload.text !== 'string'
  ) {
    throw new Error('Invalid session launch options: systemPromptPayload is required and must include transport/text')
  }

  raw.systemPromptTransport = payload.transport
  raw.systemPrompt = payload.text
  delete raw.systemPromptPayload

  // Remove undefined keys to keep the SDK payload clean.
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key]
  }
  return raw
}
