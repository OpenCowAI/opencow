// SPDX-License-Identifier: Apache-2.0

/**
 * SessionLaunchOptions — strongly-typed replacement for the `Record<string, unknown>`
 * options bag that flows through the session launch pipeline.
 *
 * Previously, `runSession()` built an untyped `Record<string, unknown>` that was
 * mutated by engine bootstrappers, policies, and capability injection.  Typos in
 * property names were silent, and the reader had no way to discover which fields
 * existed without tracing every mutation site.
 *
 * This type captures **every** property that any pipeline stage may read or write.
 * At the SDK boundary (`lifecycle.start()`), the typed object is converted to
 * `Record<string, unknown>` via `toSdkOptions()`.
 *
 * The type is intentionally engine-discriminated:
 * - Claude-specific options live only on `ClaudeSessionLaunchOptions`
 * - Codex-specific options live only on `CodexSessionLaunchOptions`
 *
 * This prevents cross-engine field pollution at compile time and makes
 * launch-option ownership explicit at each mutation stage.
 */

import type { SpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'
import type { RuntimeCanUseTool } from './enginePolicy'
import type { SDKHookMap } from '../services/capabilityCenter/claudeCodeAdapter'
import type { CodexConfigObject } from './codexMcpConfigBuilder'
import type { CodexReasoningEffort } from '../../src/shared/types'
import type {
  ProviderNativeSystemPrompt,
  CodexSyntheticSystemPrompt,
  SystemPromptTransportPayload,
} from './systemPromptTransport'

// ── Main type ───────────────────────────────────────────────────────────────

interface SessionLaunchOptionsBase {
  // ── Shared (all engines) ────────────────────────────────────────────────
  engineKind: 'claude' | 'codex'
  maxTurns: number
  includePartialMessages: boolean
  permissionMode: string
  allowDangerouslySkipPermissions: boolean
  env: Record<string, string>
  cwd?: string
  resume?: string
  model?: string
}

export interface ClaudeSessionLaunchOptions extends SessionLaunchOptionsBase {
  engineKind: 'claude'
  systemPromptPayload: ProviderNativeSystemPrompt
  // ── Claude-specific ─────────────────────────────────────────────────────
  pathToClaudeCodeExecutable?: string
  spawnClaudeCodeProcess?: (opts: SpawnOptions) => SpawnedProcess
  tools?: unknown[]
  disallowedTools?: string[]
  canUseTool?: RuntimeCanUseTool
  mcpServers?: Record<string, unknown>
  hooks?: SDKHookMap
}

export interface CodexSessionLaunchOptions extends SessionLaunchOptionsBase {
  engineKind: 'codex'
  systemPromptPayload: CodexSyntheticSystemPrompt
  // ── Codex-specific ──────────────────────────────────────────────────────
  codexModelReasoningEffort?: CodexReasoningEffort
  codexSandboxMode?: string
  codexApprovalPolicy?: string
  codexSkipGitRepoCheck?: boolean
  codexPathOverride?: string
  codexApiKey?: string
  codexBaseUrl?: string
  codexConfig?: CodexConfigObject
}

export type SessionLaunchOptions = ClaudeSessionLaunchOptions | CodexSessionLaunchOptions

/**
 * Capability-injection option patch.
 *
 * These patches are produced by engine-specific injection adapters and later
 * merged into the launch options during orchestrator pre-flight.
 *
 * Keep this type minimal and engine-discriminated:
 * - Claude adapter may patch `mcpServers`
 * - Codex adapter may patch `codexConfig`
 */
export interface ClaudeSessionLaunchOptionPatch {
  engineKind?: 'claude'
  mcpServers?: Record<string, unknown>
}

export interface CodexSessionLaunchOptionPatch {
  engineKind?: 'codex'
  codexConfig?: CodexConfigObject
}

export type SessionLaunchOptionPatch =
  | ClaudeSessionLaunchOptionPatch
  | CodexSessionLaunchOptionPatch

function hasOwnKey<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function assertPatchKeys(
  patch: SessionLaunchOptionPatch,
  allowedKeys: ReadonlySet<string>,
): void {
  const invalidKeys = Object.keys(patch).filter((key) => !allowedKeys.has(key))
  if (invalidKeys.length > 0) {
    throw new Error(`Invalid session launch option patch: unsupported key(s): ${invalidKeys.join(', ')}`)
  }
}

/**
 * Apply engine-scoped patch fields into typed launch options.
 *
 * This merge is intentionally strict:
 * - disallows mixed claude/codex patch fields
 * - disallows unknown keys
 * - validates engine-kind compatibility
 */
export function applySessionLaunchOptionPatch(
  options: SessionLaunchOptions,
  patch: SessionLaunchOptionPatch,
): void {
  if (Object.keys(patch).length === 0) return

  const hasClaudePatchField = hasOwnKey(patch, 'mcpServers')
  const hasCodexPatchField = hasOwnKey(patch, 'codexConfig')

  if (hasClaudePatchField && hasCodexPatchField) {
    throw new Error('Invalid session launch option patch: mixed claude/codex patch fields')
  }

  if (hasClaudePatchField) {
    assertPatchKeys(patch, new Set(['engineKind', 'mcpServers']))
    const claudePatch = patch as ClaudeSessionLaunchOptionPatch
    if (claudePatch.engineKind && claudePatch.engineKind !== 'claude') {
      throw new Error(`Invalid session launch option patch: engineKind=${claudePatch.engineKind} is incompatible with claude patch`)
    }
    if (options.engineKind !== 'claude') {
      throw new Error(`Session option patch engine mismatch: target=${options.engineKind}, patch=claude`)
    }
    if (claudePatch.mcpServers && Object.keys(claudePatch.mcpServers).length > 0) {
      options.mcpServers = {
        ...(options.mcpServers ?? {}),
        ...claudePatch.mcpServers,
      }
    }
    return
  }

  if (hasCodexPatchField) {
    assertPatchKeys(patch, new Set(['engineKind', 'codexConfig']))
    const codexPatch = patch as CodexSessionLaunchOptionPatch
    if (codexPatch.engineKind && codexPatch.engineKind !== 'codex') {
      throw new Error(`Invalid session launch option patch: engineKind=${codexPatch.engineKind} is incompatible with codex patch`)
    }
    if (options.engineKind !== 'codex') {
      throw new Error(`Session option patch engine mismatch: target=${options.engineKind}, patch=codex`)
    }
    if (codexPatch.codexConfig) {
      options.codexConfig = codexPatch.codexConfig
    }
    return
  }

  assertPatchKeys(patch, new Set(['engineKind']))
  if (patch.engineKind && patch.engineKind !== options.engineKind) {
    throw new Error(`Session option patch engine mismatch: target=${options.engineKind}, patch=${patch.engineKind}`)
  }
}

// ── SDK boundary conversion ─────────────────────────────────────────────────

/**
 * Convert the typed SessionLaunchOptions to the untyped Record<string, unknown>
 * required by the SDK's `lifecycle.start()` and `sdkQuery()`.
 *
 * This is the ONLY place where type safety is intentionally relaxed.
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
  if (payload.transport === 'provider_native') {
    raw.systemPrompt = payload.text
  } else {
    raw.codexSystemPrompt = payload
  }
  delete raw.systemPromptPayload

  // Remove undefined keys to keep the SDK payload clean.
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key]
  }
  return raw
}
