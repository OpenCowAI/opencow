// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  applySessionLaunchOptionPatch,
  toSdkOptions,
  type SessionLaunchOptions,
} from '../../../electron/command/sessionLaunchOptions'
import {
  createCodexSyntheticSystemPrompt,
  createProviderNativeSystemPrompt,
} from '../../../electron/command/systemPromptTransport'

describe('sessionLaunchOptions.toSdkOptions', () => {
  it('serializes provider-native payload to systemPrompt + transport', () => {
    const options: SessionLaunchOptions = {
      engineKind: 'claude',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createProviderNativeSystemPrompt('CLAUDE SYSTEM PROMPT'),
    }

    const sdk = toSdkOptions(options)
    expect(sdk.systemPromptTransport).toBe('provider_native')
    expect(sdk.systemPrompt).toBe('CLAUDE SYSTEM PROMPT')
    expect(sdk.codexSystemPrompt).toBeUndefined()
    expect((sdk as Record<string, unknown>).systemPromptPayload).toBeUndefined()
  })

  it('preserves claude initialMessages for SDK runtime seeding', () => {
    const initialMessages = [{ type: 'user', message: { role: 'user', content: 'history' } }]
    const options: SessionLaunchOptions = {
      engineKind: 'claude',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createProviderNativeSystemPrompt('CLAUDE SYSTEM PROMPT'),
      initialMessages,
    }

    const sdk = toSdkOptions(options)
    expect((sdk as { initialMessages?: unknown[] }).initialMessages).toEqual(initialMessages)
  })

  it('serializes codex synthetic payload to codexSystemPrompt + transport', () => {
    const options: SessionLaunchOptions = {
      engineKind: 'codex',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createCodexSyntheticSystemPrompt('CODEX SYSTEM PROMPT'),
    }

    const sdk = toSdkOptions(options)
    expect(sdk.systemPromptTransport).toBe('synthetic_first_turn_prefix')
    expect(sdk.codexSystemPrompt).toEqual({
      text: 'CODEX SYSTEM PROMPT',
      transport: 'synthetic_first_turn_prefix',
    })
    expect(sdk.systemPrompt).toBeUndefined()
    expect((sdk as Record<string, unknown>).systemPromptPayload).toBeUndefined()
  })
})

describe('sessionLaunchOptions.applySessionLaunchOptionPatch', () => {
  it('merges claude mcp patch into claude options only', () => {
    const options: SessionLaunchOptions = {
      engineKind: 'claude',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createProviderNativeSystemPrompt('SYSTEM'),
      mcpServers: {
        existing: { command: 'node', args: ['existing.js'] },
      },
    }

    applySessionLaunchOptionPatch(options, {
      engineKind: 'claude',
      mcpServers: {
        docs: { command: 'node', args: ['docs.js'] },
      },
    })

    expect(options.engineKind).toBe('claude')
    if (options.engineKind === 'claude') {
      expect(options.mcpServers).toEqual({
        existing: { command: 'node', args: ['existing.js'] },
        docs: { command: 'node', args: ['docs.js'] },
      })
    }
  })

  it('merges codex config patch into codex options only', () => {
    const options: SessionLaunchOptions = {
      engineKind: 'codex',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createCodexSyntheticSystemPrompt('SYSTEM'),
      codexConfig: {
        mcp_servers: {
          existing: { command: 'node', args: ['existing.js'] },
        },
      },
    }

    applySessionLaunchOptionPatch(options, {
      engineKind: 'codex',
      codexConfig: {
        mcp_servers: {
          docs: { command: 'node', args: ['docs.js'] },
        },
      },
    })

    expect(options.engineKind).toBe('codex')
    if (options.engineKind === 'codex') {
      expect(options.codexConfig).toEqual({
        mcp_servers: {
          docs: { command: 'node', args: ['docs.js'] },
        },
      })
    }
  })

  it('fails fast on engine mismatch patch', () => {
    const options: SessionLaunchOptions = {
      engineKind: 'codex',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createCodexSyntheticSystemPrompt('SYSTEM'),
    }

    expect(() =>
      applySessionLaunchOptionPatch(options, {
        engineKind: 'claude',
        mcpServers: {
          docs: { command: 'node', args: ['docs.js'] },
        },
      }),
    ).toThrowError(/engine mismatch/)
  })

  it('fails fast on mixed claude/codex patch fields', () => {
    const options: SessionLaunchOptions = {
      engineKind: 'claude',
      maxTurns: 6,
      includePartialMessages: true,
      permissionMode: 'default',
      allowDangerouslySkipPermissions: true,
      env: {},
      systemPromptPayload: createProviderNativeSystemPrompt('SYSTEM'),
    }

    expect(() =>
      applySessionLaunchOptionPatch(
        options,
        {
          engineKind: 'claude',
          mcpServers: {
            docs: { command: 'node', args: ['docs.js'] },
          },
          codexConfig: {
            mcp_servers: {
              bridge: { command: 'node', args: ['bridge.js'] },
            },
          },
        } as unknown as Parameters<typeof applySessionLaunchOptionPatch>[1],
      ),
    ).toThrowError(/mixed claude\/codex/)
  })
})
