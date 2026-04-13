// SPDX-License-Identifier: Apache-2.0

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AIEngineKind, CodexReasoningEffort } from '../../src/shared/types'
import type { ManagedSessionRuntimeConfig } from './managedSession'
import type { SessionLaunchOptions } from './sessionLaunchOptions'
import { createLogger } from '../platform/logger'

const log = createLogger('EngineBootstrapOptions')

/**
 * Name of the managed model_provider that OpenCow injects into the Codex
 * config when the user has configured a base URL through provider settings.
 * This ensures OpenCow's provider settings override ~/.codex/config.toml.
 */
const CODEX_MANAGED_PROVIDER_NAME = 'opencow-managed'

export interface CodexAuthConfig {
  apiKey: string
  baseUrl?: string
}

interface CodexPlatformTarget {
  platformPackage: string
  targetTriple: string
  binaryName: string
}

export interface EngineBootstrapDeps {
  getProviderDefaultModel: (engineKind: AIEngineKind) => string | undefined
  getProviderDefaultReasoningEffort: (engineKind: AIEngineKind) => CodexReasoningEffort | undefined
  getCodexAuthConfig: (engineKind: AIEngineKind) => Promise<CodexAuthConfig | null>
}

export interface BootstrapLogger {
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
}

export interface BuildEngineBootstrapOptionsInput {
  engineKind: AIEngineKind
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

type CodexApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted'
type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export interface EngineBootstrapRegistryOptions {
  claudeCliPathResolver?: () => string | undefined
  codexCliPathResolver?: () => string | undefined
}

function resolveCodexPlatformTarget(): CodexPlatformTarget | null {
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex'
  if (process.platform === 'darwin') {
    if (process.arch === 'arm64') {
      return {
        platformPackage: '@openai/codex-darwin-arm64',
        targetTriple: 'aarch64-apple-darwin',
        binaryName,
      }
    }
    if (process.arch === 'x64') {
      return {
        platformPackage: '@openai/codex-darwin-x64',
        targetTriple: 'x86_64-apple-darwin',
        binaryName,
      }
    }
    return null
  }
  if (process.platform === 'linux' || process.platform === 'android') {
    if (process.arch === 'arm64') {
      return {
        platformPackage: '@openai/codex-linux-arm64',
        targetTriple: 'aarch64-unknown-linux-musl',
        binaryName,
      }
    }
    if (process.arch === 'x64') {
      return {
        platformPackage: '@openai/codex-linux-x64',
        targetTriple: 'x86_64-unknown-linux-musl',
        binaryName,
      }
    }
    return null
  }
  if (process.platform === 'win32') {
    if (process.arch === 'arm64') {
      return {
        platformPackage: '@openai/codex-win32-arm64',
        targetTriple: 'aarch64-pc-windows-msvc',
        binaryName,
      }
    }
    if (process.arch === 'x64') {
      return {
        platformPackage: '@openai/codex-win32-x64',
        targetTriple: 'x86_64-pc-windows-msvc',
        binaryName,
      }
    }
    return null
  }
  return null
}

function toAsarUnpackedPath(filePath: string): string {
  if (!filePath.includes('app.asar') || filePath.includes('app.asar.unpacked')) {
    return filePath
  }
  return filePath.replace('app.asar', 'app.asar.unpacked')
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
    return require.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
  } catch {
    return undefined
  }
}

/**
 * Resolve the native Codex executable path and normalize it to app.asar.unpacked
 * in production so child_process.spawn executes a real filesystem path.
 */
export function resolveCodexCliPath(): string | undefined {
  const target = resolveCodexPlatformTarget()
  if (!target) return undefined

  try {
    const platformPackageJson = require.resolve(`${target.platformPackage}/package.json`)
    const candidate = path.join(
      path.dirname(platformPackageJson),
      'vendor',
      target.targetTriple,
      'codex',
      target.binaryName,
    )

    const unpackedCandidate = toAsarUnpackedPath(candidate)
    if (existsSync(unpackedCandidate)) return unpackedCandidate
    if (existsSync(candidate)) return candidate
    return undefined
  } catch {
    return undefined
  }
}

function applySharedSessionOverrides(ctx: EngineBootstrapContext): void {
  // Startup cwd is resolved once by SessionWorkspaceResolver and stored in session config.
  ctx.options.cwd = ctx.config.startupCwd
  if (ctx.resume) ctx.options.resume = ctx.resume
  // NOTE: model is NOT handled here — see `applyEngineModelResolution`.
}

/**
 * Single source of truth for model resolution across every engine.
 *
 * Resolution order (highest → lowest priority):
 *   1. Session-level explicit model  (ctx.config.model)
 *   2. Provider-level engine default (getProviderDefaultModel(engineKind))
 *   3. Leave `ctx.options.model` undefined — let the SDK raise a loud
 *      error instead of silently picking a business model for us.
 *
 * Historically each engine's bootstrapper had to remember to thread
 * `getProviderDefaultModel(...) → ctx.options.model` for its own engine.
 * ClaudeEngineBootstrapper forgot; sessions configured under the Claude
 * engine with an OpenAI-compat provider (e.g. aihubmix) silently ran on
 * the SDK's hard-coded default (`gpt-4o`) instead of the user's
 * `gpt-5.4` — see OpenCow session `ccb-nZy-zj412U4i`.
 *
 * Factoring the logic into a universal phase makes the invariant
 * structural: new engines cannot *forget* to thread model resolution
 * because there is no per-engine place to forget — the registry always
 * calls this after each bootstrapper.
 */
function applyEngineModelResolution(ctx: EngineBootstrapContext): void {
  const sessionModel = ctx.config.model?.trim()
  if (sessionModel) {
    ctx.options.model = sessionModel
    return
  }
  const providerDefault = ctx.deps.getProviderDefaultModel(ctx.engineKind)
  if (providerDefault) {
    ctx.options.model = providerDefault
  }
}

function parseCodexApprovalPolicy(value: unknown): CodexApprovalPolicy | null {
  return value === 'never' || value === 'on-request' || value === 'on-failure' || value === 'untrusted'
    ? value
    : null
}

function parseCodexSandboxMode(value: unknown): CodexSandboxMode | null {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access'
    ? value
    : null
}

function resolveCodexApprovalPolicy(
  explicitPolicy: unknown,
  permissionMode: unknown,
): CodexApprovalPolicy {
  const parsed = parseCodexApprovalPolicy(explicitPolicy)
  if (parsed) return parsed

  // Align chat settings semantics across engines:
  // - default           -> ask before sensitive operations
  // - bypassPermissions -> never ask
  if (permissionMode === 'default') {
    return 'on-request'
  }
  return 'never'
}

function resolveCodexSandboxMode(
  explicitMode: unknown,
  permissionMode: unknown,
): CodexSandboxMode {
  const parsed = parseCodexSandboxMode(explicitMode)
  if (parsed) return parsed

  // Align chat settings semantics across engines:
  // - default           -> keep sandbox protections
  // - bypassPermissions -> match Claude's non-sandboxed bypass posture
  if (permissionMode === 'bypassPermissions') {
    return 'danger-full-access'
  }
  return 'workspace-write'
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

class CodexEngineBootstrapper implements EngineBootstrapper {
  private readonly resolveCliPath: () => string | undefined

  constructor(resolveCliPath: () => string | undefined) {
    this.resolveCliPath = resolveCliPath
  }

  async apply(ctx: EngineBootstrapContext): Promise<void> {
    // Model resolution lives in the shared `applyEngineModelResolution`
    // phase that runs after every bootstrapper — see EngineBootstrapRegistry.
    // Reasoning effort is kept here because it is Codex/OpenAI-specific
    // (Anthropic-native models don't have the notion).
    const defaultCodexReasoningEffort = ctx.deps.getProviderDefaultReasoningEffort('codex')
    if (defaultCodexReasoningEffort) {
      ctx.options.codexModelReasoningEffort = defaultCodexReasoningEffort
    }

    // Codex defaults mirror the chat settings permission posture.
    ctx.options.codexSandboxMode = resolveCodexSandboxMode(
      ctx.options.codexSandboxMode,
      ctx.options.permissionMode,
    )
    ctx.options.codexApprovalPolicy = resolveCodexApprovalPolicy(
      ctx.options.codexApprovalPolicy,
      ctx.options.permissionMode,
    )
    ctx.options.codexSkipGitRepoCheck = true

    const codexCliPath = this.resolveCliPath()
    if (codexCliPath) {
      ctx.options.codexPathOverride = codexCliPath
    } else {
      ctx.logger.warn('Failed to resolve Codex CLI binary path override; falling back to SDK auto-discovery')
    }

    const codexAuth = await ctx.deps.getCodexAuthConfig('codex')
    if (codexAuth?.apiKey) ctx.options.codexApiKey = codexAuth.apiKey
    if (codexAuth?.baseUrl) {
      ctx.options.codexBaseUrl = codexAuth.baseUrl

      // ── Inject managed model_provider ─────────────────────────────────
      //
      // The Codex binary resolves its API endpoint from (highest → lowest):
      //   1. model_providers.<active>.base_url  (effective config)
      //   2. openai_base_url                    (--config flag)
      //   3. OPENAI_BASE_URL env var
      //
      // The SDK passes `baseUrl` as `--config openai_base_url=...` (priority 2),
      // but ~/.codex/config.toml may define a custom model_provider (e.g. "sub2api")
      // whose `base_url` takes priority 1, causing OpenCow's URL to be ignored.
      //
      // Fix: inject `model_provider = "opencow-managed"` with our base_url
      // via the SDK's `config` option.  The SDK serializes this into `--config`
      // flags that override config.toml values, ensuring OpenCow's provider
      // settings always win.
      //
      const existingProviders =
        (ctx.options.codexConfig as Record<string, unknown>)?.model_providers as Record<string, unknown> ?? {}

      ctx.options.codexConfig = {
        ...(ctx.options.codexConfig ?? {}),
        model_provider: CODEX_MANAGED_PROVIDER_NAME,
        model_providers: {
          ...existingProviders,
          [CODEX_MANAGED_PROVIDER_NAME]: {
            name: 'OpenCow Managed',
            base_url: codexAuth.baseUrl,
            wire_api: 'responses',
            requires_openai_auth: true,
          },
        },
      }
    }

    const hasEnvOpenAIKey = typeof ctx.sessionEnv.OPENAI_API_KEY === 'string' && ctx.sessionEnv.OPENAI_API_KEY.length > 0
    const hasEnvCodexKey = typeof ctx.sessionEnv.CODEX_API_KEY === 'string' && ctx.sessionEnv.CODEX_API_KEY.length > 0
    ctx.logger.info(
      `Codex auth context: providerApiKey=${!!codexAuth?.apiKey}, providerBaseUrl=${!!codexAuth?.baseUrl}, ` +
        `envOpenAIKey=${hasEnvOpenAIKey}, envCodexKey=${hasEnvCodexKey}`,
    )

    if (!codexAuth?.apiKey && !hasEnvOpenAIKey && !hasEnvCodexKey) {
      throw new Error(
        'Codex provider is not configured: no API key found (provider mapping / OPENAI_API_KEY / CODEX_API_KEY).',
      )
    }
  }
}

export class EngineBootstrapRegistry {
  private readonly bootstrappers: Record<AIEngineKind, EngineBootstrapper>

  constructor(options?: EngineBootstrapRegistryOptions) {
    this.bootstrappers = {
      claude: new ClaudeEngineBootstrapper(options?.claudeCliPathResolver ?? resolveClaudeCliPath),
      codex: new CodexEngineBootstrapper(options?.codexCliPathResolver ?? resolveCodexCliPath),
    }
  }

  async apply(params: BuildEngineBootstrapOptionsInput): Promise<void> {
    const ctx: EngineBootstrapContext = {
      ...params,
      logger: params.logger ?? log,
    }

    const bootstrapper = this.bootstrappers[ctx.engineKind]
    await bootstrapper.apply(ctx)
    // Unified model resolution — single source of truth across engines.
    // (See applyEngineModelResolution for the priority order.)
    applyEngineModelResolution(ctx)
    // Other session-level overrides (cwd, resume).
    applySharedSessionOverrides(ctx)
  }
}
