// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'

import { vi } from 'vitest'
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
import type { SessionLaunchOptions } from '../../../electron/command/sessionLaunchOptions'
import { createProviderNativeSystemPrompt } from '../../../electron/command/systemPromptTransport'

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
    ...overrides,
  }
}

function createOptions(overrides?: Partial<SessionLaunchOptions>): SessionLaunchOptions {
  return {
    maxTurns: 10,
    includePartialMessages: true,
    permissionMode: 'default',
    allowDangerouslySkipPermissions: true,
    env: {},
    systemPromptPayload: createProviderNativeSystemPrompt('TEST_SYSTEM_PROMPT'),
    ...overrides,
  }
}

describe('EngineBootstrapRegistry', () => {
  it('applies shared overrides', async () => {
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options = createOptions()

    await registry.apply({
      config: createConfig({
        model: 'claude-session-model',
        startupCwd: '/tmp/project',
      }),
      resume: 'resume-id',
      sessionEnv: {},
      options,
      deps: createDeps(),
    })

    expect(options.pathToClaudeCodeExecutable).toBeUndefined()
    expect(options.spawnClaudeCodeProcess).toBeUndefined()
    expect(options.model).toBe('claude-session-model')
    expect(options.cwd).toBe('/tmp/project')
    expect(options.resume).toBe('resume-id')
  })

  it('falls back to profile default model when session has no explicit override', async () => {
    // Repro: a profile-bound session on AIHubMix (gpt-5.4) was writing the
    // model to env (OPENAI_MODEL=gpt-5.4) but NOT to launchOptions.model.
    // That forced the SDK to rediscover the model via its env fallback
    // chain, which is fragile (depends on provider family detection) and
    // prevents `params.model` from carrying the alias that descriptor-based
    // reasoning-effort resolution needs. The fix: have the bootstrapper
    // consume `deps.getProviderDefaultModel()` as the second-priority
    // source. See plans/cross-provider-thinking.md §5.7.
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options = createOptions()

    await registry.apply({
      config: createConfig(),  // no config.model — session has no explicit override
      sessionEnv: {},
      options,
      deps: createDeps({
        getProviderDefaultModel: () => 'gpt-5.4',
      }),
    })

    expect(options.model).toBe('gpt-5.4')
  })

  it('prefers explicit config.model over profile default (runtime override wins)', async () => {
    // Priority: a user invoking `/model claude-opus-4-6` mid-session sets
    // `config.model` and that MUST take precedence over the profile's
    // preferred model — otherwise the override command has no effect.
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options = createOptions()

    await registry.apply({
      config: createConfig({ model: 'claude-opus-4-6' }),
      sessionEnv: {},
      options,
      deps: createDeps({
        getProviderDefaultModel: () => 'gpt-5.4',
      }),
    })

    expect(options.model).toBe('claude-opus-4-6')
  })

  it('leaves options.model unset when neither explicit nor profile default is available', async () => {
    // Baseline: a non-profile-bound session with no explicit model must
    // leave `options.model` untouched so the SDK's internal fallback chain
    // (OPENAI_MODEL env → built-in default) takes over cleanly. Writing
    // something like `'default'` would be a sentinel leak.
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options = createOptions()

    await registry.apply({
      config: createConfig(),
      sessionEnv: {},
      options,
      deps: createDeps({ getProviderDefaultModel: () => undefined }),
    })

    expect(options.model).toBeUndefined()
  })

  it('treats whitespace-only profile default model as unset', async () => {
    // Defensive: a misconfigured profile with an empty/whitespace
    // `preferredModel` must not poison `options.model`. The SDK's fallback
    // chain still runs and produces a sensible default.
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options = createOptions()

    await registry.apply({
      config: createConfig(),
      sessionEnv: {},
      options,
      deps: createDeps({ getProviderDefaultModel: () => '   ' }),
    })

    expect(options.model).toBeUndefined()
  })

  it('uses startupCwd for global (all-projects) sessions', async () => {
    const registry = new EngineBootstrapRegistry({
      claudeCliPathResolver: () => '/tmp/claude-cli.js',
    })
    const options = createOptions()

    await registry.apply({
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
})
