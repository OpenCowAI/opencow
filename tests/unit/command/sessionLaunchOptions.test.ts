// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  applySessionLaunchOptionPatch,
  toSdkOptions,
  type SessionLaunchOptions,
} from '../../../electron/command/sessionLaunchOptions'
import { createProviderNativeSystemPrompt } from '../../../electron/command/systemPromptTransport'

function baseOptions(overrides?: Partial<SessionLaunchOptions>): SessionLaunchOptions {
  return {
    maxTurns: 6,
    includePartialMessages: true,
    permissionMode: 'default',
    allowDangerouslySkipPermissions: true,
    env: {},
    systemPromptPayload: createProviderNativeSystemPrompt('SYSTEM'),
    ...overrides,
  }
}

describe('sessionLaunchOptions.toSdkOptions', () => {
  it('serializes provider-native payload to systemPrompt + transport', () => {
    const options = baseOptions({
      systemPromptPayload: createProviderNativeSystemPrompt('CLAUDE SYSTEM PROMPT'),
    })

    const sdk = toSdkOptions(options)
    expect(sdk.systemPromptTransport).toBe('provider_native')
    expect(sdk.systemPrompt).toBe('CLAUDE SYSTEM PROMPT')
    expect((sdk as Record<string, unknown>).systemPromptPayload).toBeUndefined()
  })

  it('preserves initialMessages for SDK runtime seeding', () => {
    const initialMessages = [{ type: 'user', message: { role: 'user', content: 'history' } }]
    const options = baseOptions({ initialMessages })

    const sdk = toSdkOptions(options)
    expect((sdk as { initialMessages?: unknown[] }).initialMessages).toEqual(initialMessages)
  })
})

describe('sessionLaunchOptions.applySessionLaunchOptionPatch', () => {
  it('merges mcp patch into options', () => {
    const options = baseOptions({
      mcpServers: {
        existing: { command: 'node', args: ['existing.js'] },
      },
    })

    applySessionLaunchOptionPatch(options, {
      mcpServers: {
        docs: { command: 'node', args: ['docs.js'] },
      },
    })

    expect(options.mcpServers).toEqual({
      existing: { command: 'node', args: ['existing.js'] },
      docs: { command: 'node', args: ['docs.js'] },
    })
  })

  it('is a no-op when patch is empty', () => {
    const options = baseOptions({
      mcpServers: { existing: { command: 'node' } },
    })
    applySessionLaunchOptionPatch(options, {})
    expect(options.mcpServers).toEqual({ existing: { command: 'node' } })
  })
})
