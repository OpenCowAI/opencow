// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type { CapabilityPlan } from '../../../electron/services/capabilityCenter/sessionInjector'
import type { SDKHookMap } from '../../../electron/services/capabilityCenter/claudeCodeAdapter'
import { ClaudeInjectionAdapter } from '../../../electron/command/injection/claudeInjectionAdapter'

function createPlan(overrides: Partial<CapabilityPlan> = {}): CapabilityPlan {
  return {
    capabilityPrompt: '<skill name="docs-sync">Sync docs.</skill>',
    agentPrompt: 'You are a docs agent.',
    declarativeHooks: {
      SessionStart: [
        {
          hooks: [{ type: 'prompt', prompt: 'Always validate output.' }],
        },
      ],
    },
    mcpServers: {
      docs: { command: 'node', args: ['docs-mcp.js'] },
    },
    totalChars: 88,
    summary: {
      skills: ['docs-sync'],
      agent: 'docs-agent',
      rules: [],
      hooks: ['startup-rule'],
      mcpServers: ['docs'],
      skippedDistributed: [],
      skippedByBudget: [],
      skillDecisions: [],
    },
    ...overrides,
  }
}

describe('ClaudeInjectionAdapter', () => {
  it('merges capability hooks/mcp and updates prompt layers', () => {
    const adapter = new ClaudeInjectionAdapter()
    const builtInHooks = {
      SessionStart: [{ hooks: [async () => ({ continue: true })] }],
    } as SDKHookMap
    const output = adapter.inject({
      engineKind: 'claude',
      plan: createPlan(),
      promptLayers: {
        identity: 'identity',
        base: 'base',
        session: 'session-original',
      },
      options: {
        mcpServers: {
          existing: { command: 'node', args: ['existing-mcp.js'] },
        },
      },
      builtInHooks,
    })

    expect(output.promptLayers.session).toBe('You are a docs agent.')
    expect(output.promptLayers.capability).toContain('docs-sync')
    expect(output.optionPatch).toEqual({
      mcpServers: {
        existing: { command: 'node', args: ['existing-mcp.js'] },
        docs: { command: 'node', args: ['docs-mcp.js'] },
      },
    })
    expect(output.hooks?.SessionStart).toHaveLength(2)
    expect(output.activeMcpServerNames?.has('docs')).toBe(true)
  })
})
