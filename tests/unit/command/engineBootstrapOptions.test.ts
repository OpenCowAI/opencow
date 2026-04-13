// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { homedir } from 'node:os'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}))
import type { ManagedSessionRuntimeConfig } from '../../../electron/command/managedSession'
import {
  EngineBootstrapRegistry,
  type EngineBootstrapDeps,
} from '../../../electron/command/engineBootstrapOptions'

function createConfig(overrides?: Partial<ManagedSessionRuntimeConfig>): ManagedSessionRuntimeConfig {
  return {
    prompt: 'hello',
    origin: { source: 'agent' },
    startupCwd: homedir(),
    ...overrides,
  }
}

function createDeps(overrides?: Partial<EngineBootstrapDeps>): EngineBootstrapDeps {
  return {
    getProviderDefaultModel: () => undefined,
    getProviderDefaultReasoningEffort: () => undefined,
    getCodexAuthConfig: async () => null,
    ...overrides,
  }
}

describe('EngineBootstrapRegistry', () => {
  it('applies shared overrides and Claude cli path', async () => {
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'claude',
      config: createConfig({
        model: 'claude-session-model',
        startupCwd: '/tmp/project',
      }),
      resume: 'resume-id',
      sessionEnv: {},
      options,
      deps: createDeps(),
    })

    expect(options.pathToClaudeCodeExecutable).toBe('/tmp/claude-cli.js')
    expect(options.model).toBe('claude-session-model')
    expect(options.cwd).toBe('/tmp/project')
    expect(options.resume).toBe('resume-id')
  })

  // ── applyEngineModelResolution (unified model resolution phase) ──
  //
  // These tests lock in the contract that model resolution is engine-
  // agnostic: the same priority chain applies to claude / codex / any
  // future engine, and the registry enforces it structurally (each
  // bootstrapper no longer carries its own `getProviderDefaultModel →
  // ctx.options.model` line). Regression surface for OpenCow session
  // `ccb-nZy-zj412U4i` (user configured aihubmix + gpt-5.4, session
  // actually ran on the SDK's silent `gpt-4o` default because the
  // Claude bootstrapper had no model-threading code).

  it('threads provider defaultModel into options.model (Claude engine, no session override)', async () => {
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'claude',
      config: createConfig({ startupCwd: '/tmp/project' }),
      sessionEnv: {},
      options,
      deps: createDeps({ getProviderDefaultModel: () => 'gpt-5.4' }),
    })

    expect(options.model).toBe('gpt-5.4')
  })

  it('threads provider defaultModel into options.model (Codex engine, no session override)', async () => {
    // Regression: after pulling the Codex-local `if (defaultCodexModel)
    // ctx.options.model = ...` line out of CodexEngineBootstrapper,
    // Codex must still pick up the provider default via the shared phase.
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {
      permissionMode: 'bypassPermissions',
    }

    await registry.apply({
      engineKind: 'codex',
      config: createConfig({ startupCwd: '/tmp/project' }),
      sessionEnv: {},
      options,
      deps: createDeps({
        getProviderDefaultModel: () => 'gpt-5.3-codex',
        getCodexAuthConfig: async () => ({
          apiKey: 'codex-key',
          baseUrl: 'https://codex.example/v1',
        }),
      }),
    })

    expect(options.model).toBe('gpt-5.3-codex')
  })

  it('session-config model beats provider defaultModel across engines', async () => {
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'claude',
      config: createConfig({
        model: 'user-picked-model',
        startupCwd: '/tmp/p',
      }),
      sessionEnv: {},
      options,
      deps: createDeps({ getProviderDefaultModel: () => 'provider-default' }),
    })

    expect(options.model).toBe('user-picked-model')
  })

  it('leaves options.model undefined when neither session nor provider has a model', async () => {
    // Loud-failure invariant: without a resolvable model, we do NOT
    // silently pick one. The SDK is then expected to raise a clear
    // error, which is how host-side wiring bugs surface immediately
    // instead of masquerading as "wrong model silently used".
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'claude',
      config: createConfig({ startupCwd: '/tmp/p' }),
      sessionEnv: {},
      options,
      deps: createDeps({ getProviderDefaultModel: () => undefined }),
    })

    expect(options.model).toBeUndefined()
  })

  it('uses startupCwd for global (all-projects) sessions', async () => {
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'claude',
      config: createConfig({
        model: 'claude-session-model',
        startupCwd: homedir(),
      }),
      sessionEnv: {},
      options,
      deps: createDeps(),
    })

    expect(options.cwd).toBe(homedir())
  })

  it('applies Codex defaults/auth and injects managed provider via SDK config', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {
      permissionMode: 'bypassPermissions',
    }

    await registry.apply({
      engineKind: 'codex',
      config: createConfig({
        model: 'gpt-5.3-codex',
      }),
      sessionEnv: {},
      options,
      deps: createDeps({
        getProviderDefaultModel: () => 'provider-model',
        getProviderDefaultReasoningEffort: () => 'high',
        getCodexAuthConfig: async () => ({
          apiKey: 'codex-key',
          baseUrl: 'https://codex.example/v1',
        }),
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    expect(options.model).toBe('gpt-5.3-codex')
    expect(options.codexModelReasoningEffort).toBe('high')
    expect(options.codexSandboxMode).toBe('danger-full-access')
    expect(options.codexApprovalPolicy).toBe('never')
    expect(options.codexSkipGitRepoCheck).toBe(true)
    expect(options.codexPathOverride).toBe('/tmp/codex-bin')
    expect(options.codexApiKey).toBe('codex-key')
    expect(options.codexBaseUrl).toBe('https://codex.example/v1')

    // The SDK's config option receives model_provider + provider definition.
    // The SDK serializes these into --config flags that override config.toml.
    const config = options.codexConfig as Record<string, unknown>
    expect(config).toBeTruthy()
    expect(config.model_provider).toBe('opencow-managed')
    const providers = config.model_providers as Record<string, Record<string, unknown>>
    expect(providers['opencow-managed']).toEqual({
      name: 'OpenCow Managed',
      base_url: 'https://codex.example/v1',
      wire_api: 'responses',
      requires_openai_auth: true,
    })
  })

  it('preserves pre-existing codexConfig fields when injecting managed provider', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    // Simulate codexConfig that was set by an earlier pipeline stage (e.g. MCP servers)
    const options: Record<string, unknown> = {
      codexConfig: {
        mcp_servers: { 'my-tool': { command: '/usr/bin/node', args: ['tool.js'] } },
        some_other_setting: 42,
      },
    }

    await registry.apply({
      engineKind: 'codex',
      config: createConfig(),
      sessionEnv: {},
      options,
      deps: createDeps({
        getCodexAuthConfig: async () => ({
          apiKey: 'codex-key',
          baseUrl: 'https://codex.example/v1',
        }),
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    const config = options.codexConfig as Record<string, unknown>
    expect(config).toBeTruthy()
    // Injected provider fields
    expect(config.model_provider).toBe('opencow-managed')
    expect(config.model_providers).toBeTruthy()
    // Pre-existing fields are preserved
    expect(config.mcp_servers).toEqual({
      'my-tool': { command: '/usr/bin/node', args: ['tool.js'] },
    })
    expect(config.some_other_setting).toBe(42)
  })

  it('does not inject model_provider when provider baseUrl is absent', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'codex',
      config: createConfig(),
      sessionEnv: { OPENAI_API_KEY: 'env-key' },
      options,
      deps: createDeps({
        getCodexAuthConfig: async () => ({
          apiKey: 'codex-key',
          // No baseUrl
        }),
      }),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    // codexConfig should be absent or not contain model_provider
    const config = options.codexConfig as Record<string, unknown> | undefined
    expect(config?.model_provider).toBeUndefined()
  })

  it('maps command permissionMode=default to Codex approvalPolicy=on-request', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {
      permissionMode: 'default',
    }

    await registry.apply({
      engineKind: 'codex',
      config: createConfig(),
      sessionEnv: {
        OPENAI_API_KEY: 'env-openai-key',
      },
      options,
      deps: createDeps(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    expect(options.codexApprovalPolicy).toBe('on-request')
    expect(options.codexSandboxMode).toBe('workspace-write')
  })

  it('preserves explicit Codex approvalPolicy override when provided', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {
      permissionMode: 'default',
      codexApprovalPolicy: 'on-failure',
    }

    await registry.apply({
      engineKind: 'codex',
      config: createConfig(),
      sessionEnv: {
        OPENAI_API_KEY: 'env-openai-key',
      },
      options,
      deps: createDeps(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    expect(options.codexApprovalPolicy).toBe('on-failure')
  })

  it('preserves explicit Codex sandbox mode override when provided', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {
      permissionMode: 'bypassPermissions',
      codexSandboxMode: 'workspace-write',
    }

    await registry.apply({
      engineKind: 'codex',
      config: createConfig(),
      sessionEnv: {
        OPENAI_API_KEY: 'env-openai-key',
      },
      options,
      deps: createDeps(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    expect(options.codexSandboxMode).toBe('workspace-write')
  })

  it('fails closed when Codex auth is missing from provider and env', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => undefined,
    })

    await expect(
      registry.apply({
        engineKind: 'codex',
        config: createConfig(),
        sessionEnv: {},
        options: {},
        deps: createDeps({
          getCodexAuthConfig: async () => null,
        }),
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
      }),
    ).rejects.toThrow('Codex provider is not configured')
  })

  it('allows Codex bootstrap when env has OpenAI key even without mapped auth', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => undefined,
    })
    const options: Record<string, unknown> = {}

    await expect(
      registry.apply({
        engineKind: 'codex',
        config: createConfig(),
        sessionEnv: {
          OPENAI_API_KEY: 'env-openai-key',
        },
        options,
        deps: createDeps({
          getCodexAuthConfig: async () => null,
        }),
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
        },
      }),
    ).resolves.toBeUndefined()

    expect(options.codexSandboxMode).toBe('workspace-write')
  })

  it('always applies explicit session model override as highest priority', async () => {
    const registry = new EngineBootstrapRegistry({
      codexCliPathResolver: () => '/tmp/codex-bin',
    })
    const options: Record<string, unknown> = {}

    await registry.apply({
      engineKind: 'codex',
      config: createConfig({
        model: 'claude-sonnet-4-6',
      }),
      sessionEnv: {
        OPENAI_API_KEY: 'env-openai-key',
      },
      options,
      deps: createDeps(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    })

    expect(options.model).toBe('claude-sonnet-4-6')
  })
})
