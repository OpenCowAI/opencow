// SPDX-License-Identifier: Apache-2.0

import type { ManagedSessionRuntimeConfig } from './managedSession'
import type { SessionLaunchOptions } from './sessionLaunchOptions'
import { createLogger } from '../platform/logger'

const log = createLogger('EngineBootstrapOptions')

export interface EngineBootstrapDeps {
  getProviderDefaultModel: () => string | undefined
}

export interface BootstrapLogger {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

export interface BuildEngineBootstrapOptionsInput {
  config: ManagedSessionRuntimeConfig
  resume?: string
  sessionEnv: Record<string, string>
  options: SessionLaunchOptions
  deps: EngineBootstrapDeps
  logger?: BootstrapLogger
}

interface EngineBootstrapContext extends Omit<BuildEngineBootstrapOptionsInput, 'logger'> {
  logger: BootstrapLogger
}

interface EngineBootstrapper {
  apply(ctx: EngineBootstrapContext): Promise<void>
}

export interface EngineBootstrapRegistryOptions {
  claudeCliPathResolver?: () => string | undefined
}

/**
 * Resolve the path to the SDK's bundled cli.js.
 *
 * The returned path may be inside app.asar — that is fine because the child
 * process is spawned with ELECTRON_RUN_AS_NODE=1 (via createAsarAwareSpawnFn)
 * and can read from asar natively.
 */
export function resolveClaudeCliPath(): string | undefined {
  try {
    return require.resolve('@opencow-ai/opencow-agent-sdk/dist/cli.mjs')
  } catch {
    return undefined
  }
}

function applySharedSessionOverrides(ctx: EngineBootstrapContext): void {
  // Startup cwd is resolved once by SessionWorkspaceResolver and stored in session config.
  ctx.options.cwd = ctx.config.startupCwd
  if (ctx.resume) ctx.options.resume = ctx.resume
  const modelOverride = ctx.config.model ?? null
  if (typeof modelOverride === 'string' && modelOverride.trim().length > 0) {
    ctx.options.model = modelOverride
  }
}

class ClaudeEngineBootstrapper implements EngineBootstrapper {
  private readonly resolveCliPath: () => string | undefined

  constructor(resolveCliPath: () => string | undefined) {
    this.resolveCliPath = resolveCliPath
  }

  async apply(ctx: EngineBootstrapContext): Promise<void> {
    // Phase 1B.11 cleanup (AC #11): the historical
    // `pathToClaudeCodeExecutable` and `spawnClaudeCodeProcess` writes
    // were no-ops against the opencow-agent-sdk fork. Spike 3 in
    // 2026-04-09-phase-1B-discovery-data.md §6.4 v2 confirmed that:
    //
    //   1. OpenCow loads the SDK via dynamic ESM import('dist/sdk.js') in
    //      electron/command/queryLifecycle.ts:34-42 — no child_process.spawn.
    //   2. The fork's runSdkQueryRuntime (src/core/sdkRuntime.ts) runs the
    //      query engine in-process via direct ask() invocation.
    //   3. `pathToClaudeCodeExecutable` and `spawnClaudeCodeProcess` are
    //      declared in the SDK's Options type but have ZERO consumers in
    //      src/. They're upstream Anthropic SDK leftovers.
    //
    // The pre-1B.11 ClaudeEngineBootstrapper wrote both fields anyway;
    // the writes never had any runtime effect. Both fields are now marked
    // @deprecated in the SDK (added in commit 225a161). The bootstrapper
    // doesn't need to write them at all.
    //
    // Future cleanup: simplify ClaudeEngineBootstrapper.apply to a no-op
    // body, then remove the resolveCliPath constructor param entirely.
    void this.resolveCliPath
  }
}

export class EngineBootstrapRegistry {
  private readonly claudeBootstrapper: EngineBootstrapper

  constructor(options?: EngineBootstrapRegistryOptions) {
    this.claudeBootstrapper = new ClaudeEngineBootstrapper(options?.claudeCliPathResolver ?? resolveClaudeCliPath)
  }

  async apply(params: BuildEngineBootstrapOptionsInput): Promise<void> {
    const ctx: EngineBootstrapContext = {
      ...params,
      logger: params.logger ?? log,
    }

    await this.claudeBootstrapper.apply(ctx)
    // Session-level config must keep highest priority over engine defaults.
    applySharedSessionOverrides(ctx)
  }
}
