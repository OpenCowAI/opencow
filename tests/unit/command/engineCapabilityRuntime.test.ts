// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import type { CapabilityCenter } from '../../../electron/services/capabilityCenter'
import type { CapabilityPlan } from '../../../electron/services/capabilityCenter/sessionInjector'
import { EngineCapabilityRuntime } from '../../../electron/command/engineCapabilityRuntime'
import type { SDKHookMap } from '../../../electron/services/capabilityCenter/claudeCodeAdapter'
import {
  createCodexSyntheticSystemPrompt,
  createProviderNativeSystemPrompt,
} from '../../../electron/command/systemPromptTransport'

function createClaudeOptions() {
  return {
    engineKind: 'claude' as const,
    maxTurns: 8,
    includePartialMessages: true,
    permissionMode: 'acceptEdits',
    allowDangerouslySkipPermissions: true,
    env: {},
    systemPromptPayload: createProviderNativeSystemPrompt(''),
  }
}

function createCodexOptions() {
  return {
    engineKind: 'codex' as const,
    maxTurns: 8,
    includePartialMessages: true,
    permissionMode: 'acceptEdits',
    allowDangerouslySkipPermissions: true,
    env: {},
    systemPromptPayload: createCodexSyntheticSystemPrompt(''),
  }
}

function createPlan(overrides: Partial<CapabilityPlan> = {}): CapabilityPlan {
  return {
    capabilityPrompt: '<skill name="code-review">Review checklist</skill>',
    agentPrompt: 'You are a reviewer.',
    declarativeHooks: {},
    mcpServers: {},
    nativeRequirements: [],
    totalChars: 64,
    summary: {
      skills: ['code-review'],
      agent: 'reviewer',
      rules: [],
      hooks: [],
      mcpServers: [],
      skippedDistributed: [],
      skippedByBudget: [],
      skillDecisions: [],
    },
    ...overrides,
  }
}

describe('EngineCapabilityRuntime', () => {
  it('returns fallback output when capability center is absent', async () => {
    const runtime = new EngineCapabilityRuntime({})
    const builtInHooks = {
      SessionStart: [{ hooks: [async () => ({ continue: true })] }],
    } as SDKHookMap

    const result = await runtime.apply({
      engineKind: 'claude',
      planInput: {
        request: {
          session: { engineKind: 'claude' },
        },
      },
      promptLayers: {
        identity: 'identity',
        base: 'base',
      },
      options: createClaudeOptions(),
      builtInHooks,
    })

    expect(result.promptLayers).toEqual({
      identity: 'identity',
      base: 'base',
    })
    expect(result.optionPatch).toEqual({})
    expect(result.hooks).toBe(builtInHooks)
  })

  it('applies codex prompt-layer injection via adapter', async () => {
    const buildCapabilityPlan = vi.fn().mockResolvedValue(createPlan())
    const runtime = new EngineCapabilityRuntime({
      capabilityCenter: { buildCapabilityPlan } as unknown as CapabilityCenter,
    })

    const result = await runtime.apply({
      engineKind: 'codex',
      planInput: {
        projectId: 'project-1',
        request: {
          session: { engineKind: 'codex' },
        },
      },
      promptLayers: {
        identity: 'identity',
        base: 'base',
        session: 'session-original',
      },
      options: createCodexOptions(),
    })

    expect(buildCapabilityPlan).toHaveBeenCalledWith({
      projectId: 'project-1',
      request: {
        session: { engineKind: 'codex' },
      },
    })
    expect(result.promptLayers.session).toBe('You are a reviewer.')
    expect(result.promptLayers.capability).toContain('code-review')
    expect(result.optionPatch).toEqual({})
  })

  it('degrades safely when capability plan building throws', async () => {
    const runtime = new EngineCapabilityRuntime({
      capabilityCenter: {
        buildCapabilityPlan: vi.fn().mockRejectedValue(new Error('boom')),
      } as unknown as CapabilityCenter,
    })

    const result = await runtime.apply({
      engineKind: 'codex',
      planInput: {
        request: {
          session: { engineKind: 'codex' },
        },
      },
      promptLayers: {
        identity: 'identity',
      },
      options: createCodexOptions(),
    })

    expect(result.promptLayers).toEqual({ identity: 'identity' })
    expect(result.optionPatch).toEqual({})
  })

  it('fails fast when runtime engine and launch options engine mismatch', async () => {
    const buildCapabilityPlan = vi.fn().mockResolvedValue(createPlan())
    const runtime = new EngineCapabilityRuntime({
      capabilityCenter: { buildCapabilityPlan } as unknown as CapabilityCenter,
    })

    await expect(
      runtime.apply({
        engineKind: 'codex',
        planInput: {
          request: {
            session: { engineKind: 'codex' },
          },
        },
        promptLayers: {
          identity: 'identity',
        },
        options: createClaudeOptions(),
      }),
    ).rejects.toThrow('Capability injection engine mismatch')
  })
})
