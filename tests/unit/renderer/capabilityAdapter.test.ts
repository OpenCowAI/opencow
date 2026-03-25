// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { capabilityToSlashItem } from '../../../src/renderer/lib/capabilityAdapter'
import type { DocumentCapabilityEntry } from '../../../src/shared/types'

function makeDocEntry(
  overrides: Partial<DocumentCapabilityEntry> & Pick<DocumentCapabilityEntry, 'name' | 'category'>,
): DocumentCapabilityEntry {
  return {
    kind: 'document',
    description: '',
    body: '',
    attributes: {},
    filePath: '',
    scope: 'global',
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: {},
    importInfo: null,
    distributionInfo: null,
    ...overrides,
  }
}

describe('capabilityToSlashItem', () => {
  it('maps normal command without app presentation metadata', () => {
    const entry = makeDocEntry({
      name: 'review-pr',
      category: 'command',
      description: 'Review pull request',
      attributes: { 'argument-hint': '<pr>' },
      filePath: '.opencow/commands/review-pr.md',
      scope: 'project',
    })

    const item = capabilityToSlashItem(entry, 'command', 0)

    expect(item).toMatchObject({
      id: 'command:project:review-pr',
      name: 'review-pr',
      description: 'Review pull request',
      argumentHint: '<pr>',
      category: 'command',
      order: 1,
      scope: 'project',
      sourcePath: '.opencow/commands/review-pr.md',
    })
    expect(item.presentation).toBeUndefined()
    expect(item.executionMeta).toBeUndefined()
  })

  it('maps evose skill metadata to app presentation + execution metadata', () => {
    const entry = makeDocEntry({
      name: 'evose:x_analyst_abc123',
      category: 'skill',
      description: 'X trend analyzer',
      metadata: {
        provider: 'evose',
        appId: 'app-x-analyst',
        appType: 'agent',
        displayName: 'X Analyst',
        avatar: 'https://example.com/avatar.png',
        gatewayTool: 'evose_run_agent',
      },
    })

    const item = capabilityToSlashItem(entry, 'skill', 0)

    expect(item.presentation).toEqual({
      variant: 'app',
      title: 'X Analyst',
      subtitle: 'X trend analyzer',
      avatarUrl: 'https://example.com/avatar.png',
    })
    expect(item.executionMeta).toEqual({
      provider: 'evose',
      app: {
        id: 'app-x-analyst',
        type: 'agent',
        gatewayTool: 'evose_run_agent',
      },
    })
  })

  it('ignores malformed evose metadata and falls back to default slash item', () => {
    const entry = makeDocEntry({
      name: 'evose:broken_app',
      category: 'skill',
      description: 'Broken metadata',
      metadata: {
        provider: 'evose',
        appId: '',
        appType: 'agent',
        displayName: '',
        gatewayTool: 'evose_run_agent',
      },
    })

    const item = capabilityToSlashItem(entry, 'skill', 0)
    expect(item.presentation).toBeUndefined()
    expect(item.executionMeta).toBeUndefined()
  })
})

