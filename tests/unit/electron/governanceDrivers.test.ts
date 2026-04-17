// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import { ClaudeGovernanceDriver } from '../../../electron/services/capabilityCenter/governance/claudeGovernanceDriver'
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

  it('forwards calls to underlying implementation', async () => {
    const impl = createImpl()
    const driver = new ClaudeGovernanceDriver(impl)

    await driver.discover({ projectPath: '/tmp/project' })
    await driver.importItem({
      item: {
        name: 'alpha',
        category: 'skill',
        description: '',
        sourcePath: '/tmp/source',
        sourceType: 'claude-code',
        alreadyImported: false,
        sourceScope: 'global',
      },
      target: { scope: 'global' },
      store: {} as never,
      stateRepo: {} as never,
    })
    await driver.publish({
      category: 'skill',
      name: 'alpha',
      target: 'claude-code-global',
      store: {} as never,
      stateRepo: {} as never,
      strategy: 'copy',
    })
    await driver.unpublish({
      category: 'skill',
      name: 'alpha',
      target: 'claude-code-global',
      stateRepo: {} as never,
    })
    await driver.detectDrift({ distributions: [], store: {} as never })

    expect(impl.discover).toHaveBeenCalledTimes(1)
    expect(impl.importItem).toHaveBeenCalledTimes(1)
    expect(impl.publish).toHaveBeenCalledTimes(1)
    expect(impl.unpublish).toHaveBeenCalledTimes(1)
    expect(impl.detectDrift).toHaveBeenCalledTimes(1)
  })
})
