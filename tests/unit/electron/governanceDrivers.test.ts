// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { ClaudeGovernanceDriver } from '../../../electron/services/capabilityCenter/governance/claudeGovernanceDriver'
import { CodexGovernanceDriver } from '../../../electron/services/capabilityCenter/governance/codexGovernanceDriver'
import type { EngineGovernanceDriver, GovernanceOperation } from '../../../electron/services/capabilityCenter/governance/engineGovernanceDriver'
import type { ManagedCapabilityCategory } from '../../../src/shared/types'

function createImpl(): Omit<EngineGovernanceDriver, 'engineKind' | 'supports'> {
  return {
    discover: vi.fn(async () => []),
    importItem: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    unpublish: vi.fn(async () => {}),
    detectDrift: vi.fn(async () => []),
  }
}

describe('Governance drivers', () => {
  const categories: ManagedCapabilityCategory[] = [
    'skill',
    'agent',
    'command',
    'rule',
    'hook',
    'mcp-server',
  ]
  const operations: GovernanceOperation[] = [
    'discover',
    'import',
    'publish',
    'unpublish',
    'detect-drift',
  ]

  it('ClaudeGovernanceDriver supports all categories/operations', () => {
    const driver = new ClaudeGovernanceDriver(createImpl())
    for (const category of categories) {
      for (const operation of operations) {
        expect(driver.supports(category, operation)).toBe(true)
      }
    }
  })

  it('CodexGovernanceDriver supports only skill and mcp-server', () => {
    const driver = new CodexGovernanceDriver(createImpl())
    for (const operation of operations) {
      expect(driver.supports('skill', operation)).toBe(true)
      expect(driver.supports('mcp-server', operation)).toBe(true)
      expect(driver.supports('agent', operation)).toBe(false)
      expect(driver.supports('command', operation)).toBe(false)
      expect(driver.supports('rule', operation)).toBe(false)
      expect(driver.supports('hook', operation)).toBe(false)
    }
  })

  it('forwards calls to underlying implementation', async () => {
    const impl = createImpl()
    const driver = new CodexGovernanceDriver(impl)

    await driver.discover({ projectPath: '/tmp/project' })
    await driver.importItem({
      item: {
        name: 'alpha',
        category: 'skill',
        description: '',
        sourcePath: '/tmp/source',
        sourceType: 'codex',
        alreadyImported: false,
        sourceScope: 'global',
      },
      target: { scope: 'global' },
      store: {} as any,
      stateRepo: {} as any,
    })
    await driver.publish({
      category: 'skill',
      name: 'alpha',
      target: 'codex-global',
      store: {} as any,
      stateRepo: {} as any,
      strategy: 'copy',
    })
    await driver.unpublish({
      category: 'skill',
      name: 'alpha',
      target: 'codex-global',
      stateRepo: {} as any,
    })
    await driver.detectDrift({ distributions: [], store: {} as any })

    expect(impl.discover).toHaveBeenCalledTimes(1)
    expect(impl.importItem).toHaveBeenCalledTimes(1)
    expect(impl.publish).toHaveBeenCalledTimes(1)
    expect(impl.unpublish).toHaveBeenCalledTimes(1)
    expect(impl.detectDrift).toHaveBeenCalledTimes(1)
  })
})
