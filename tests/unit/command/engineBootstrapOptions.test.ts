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
