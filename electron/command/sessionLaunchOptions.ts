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
 * The type is intentionally flat (no discriminated union on engineKind) because
 * the mutation stages are engine-agnostic — they set Claude-only or Codex-only
 * fields conditionally, and the SDK ignores unknown keys.
 */

import type { RuntimeCanUseTool } from './enginePolicy'
import type { SDKHookMap } from '../services/capabilityCenter/claudeCodeAdapter'
import type { CodexConfigObject } from './codexMcpConfigBuilder'
import type { CodexReasoningEffort } from '../../src/shared/types'

// ── Main type ───────────────────────────────────────────────────────────────

export interface SessionLaunchOptions {
  // ── Shared (all engines) ────────────────────────────────────────────────
  maxTurns: number
  includePartialMessages: boolean
  permissionMode: string
  allowDangerouslySkipPermissions: boolean
  env: Record<string, string>
  cwd?: string
  resume?: string
  model?: string

  // ── Claude-specific ─────────────────────────────────────────────────────
  pathToClaudeCodeExecutable?: string
  tools?: unknown[]
  disallowedTools?: string[]
  canUseTool?: RuntimeCanUseTool
  mcpServers?: Record<string, unknown>
  systemPrompt?: string
  hooks?: SDKHookMap

  // ── Codex-specific ──────────────────────────────────────────────────────
  codexModelReasoningEffort?: CodexReasoningEffort
  codexSandboxMode?: string
  codexApprovalPolicy?: string
  codexSkipGitRepoCheck?: boolean
  codexPathOverride?: string
  codexApiKey?: string
  codexBaseUrl?: string
  codexConfig?: CodexConfigObject
  codexSystemPrompt?: string
}

// ── SDK boundary conversion ─────────────────────────────────────────────────

/**
 * Convert the typed SessionLaunchOptions to the untyped Record<string, unknown>
 * required by the SDK's `lifecycle.start()` and `sdkQuery()`.
 *
 * This is the ONLY place where type safety is intentionally relaxed.
 */
export function toSdkOptions(options: SessionLaunchOptions): Record<string, unknown> {
  // Spread creates a shallow copy — safe because the SDK should not mutate.
  const raw: Record<string, unknown> = { ...options }
  // Remove undefined keys to keep the SDK payload clean.
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key]
  }
  return raw
}
