// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type { DocumentCapabilityEntry } from '../../../src/shared/types'
import { buildRulePromptSegment } from '../../../electron/services/capabilityCenter/promptSegmentBuilder'

function createRule(params: {
  name: string
  body: string
  description?: string
}): DocumentCapabilityEntry {
  return {
    kind: 'document',
    name: params.name,
    description: params.description ?? '',
    body: params.body,
    attributes: {},
    filePath: `/tmp/${params.name}.md`,
    category: 'rule',
    scope: 'global',
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: {},
    importInfo: null,
    distributionInfo: null,
    mountInfo: null,
  }
}

describe('promptSegmentBuilder', () => {
  it('escapes xml attributes and wraps rule body in CDATA', () => {
    const rule = createRule({
      name: 'docs-"sync"<a>',
      body: 'line 1 ]]> line 2',
    })

    const segment = buildRulePromptSegment(rule)

    expect(segment.content).toContain('name="docs-&quot;sync&quot;&lt;a&gt;"')
    expect(segment.content).toContain('<instructions><![CDATA[')
    expect(segment.content).toContain(']]]]><![CDATA[>')
  })

  it('renders rules in the same safe structure', () => {
    const rule = createRule({
      name: 'guard-rails',
      body: 'Never run destructive commands.',
    })

    const segment = buildRulePromptSegment(rule)
    expect(segment.content).toContain('<rule name="guard-rails">')
    expect(segment.content).toContain('<instructions><![CDATA[Never run destructive commands.')
  })
})
