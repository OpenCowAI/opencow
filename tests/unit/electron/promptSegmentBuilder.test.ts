// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type { DocumentCapabilityEntry } from '../../../src/shared/types'
import { buildRulePromptSegment, buildSkillPromptSegment } from '../../../electron/services/capabilityCenter/promptSegmentBuilder'

function createSkill(params: {
  name: string
  body: string
  description?: string
  attributes?: Record<string, unknown>
}): DocumentCapabilityEntry {
  return {
    kind: 'document',
    name: params.name,
    description: params.description ?? '',
    body: params.body,
    attributes: params.attributes ?? {},
    filePath: `/tmp/${params.name}.md`,
    category: 'skill',
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
  it('escapes xml attributes and wraps full body in CDATA', () => {
    const skill = createSkill({
      name: 'docs-"sync"<a>',
      body: 'line 1 ]]> line 2',
    })

    const segment = buildSkillPromptSegment(skill, {
      skillName: skill.name,
      mode: 'full',
      source: 'explicit',
      reason: 'test',
    })

    expect(segment.content).toContain('name="docs-&quot;sync&quot;&lt;a&gt;"')
    expect(segment.content).toContain('<instructions><![CDATA[')
    expect(segment.content).toContain(']]]]><![CDATA[>')
  })

  it('renders catalog frontmatter projection', () => {
    const skill = createSkill({
      name: 'docs-sync',
      body: 'FULL BODY',
      description: 'sync docs',
      attributes: {
        name: 'docs-sync',
        description: 'sync docs',
      },
    })

    const segment = buildSkillPromptSegment(skill, {
      skillName: skill.name,
      mode: 'catalog',
      source: 'default',
      reason: 'test',
    })

    expect(segment.content).toContain('<frontmatter><![CDATA[')
    expect(segment.content).toContain('description: sync docs')
    expect(segment.content).not.toContain('FULL BODY')
  })

  it('uses <evose-app> tag for Evose skills instead of <skill>', () => {
    const evoseSkill = createSkill({
      name: 'evose:x_analyst_ja4t9n',
      body: 'Call evose_run_agent with app_id: "agent_123"',
      description: 'Run Evose agent "X Analyst"',
    })
    evoseSkill.metadata = {
      provider: 'evose',
      appId: 'agent_123',
      appType: 'agent',
      gatewayTool: 'evose_run_agent',
    }

    const fullSegment = buildSkillPromptSegment(evoseSkill, {
      skillName: evoseSkill.name,
      mode: 'full',
      source: 'implicit',
      reason: 'matched',
    })

    expect(fullSegment.content).toContain('<evose-app')
    expect(fullSegment.content).toContain('gateway-tool="evose_run_agent"')
    expect(fullSegment.content).toContain('app-id="agent_123"')
    expect(fullSegment.content).not.toContain('<skill')

    const catalogSegment = buildSkillPromptSegment(evoseSkill, {
      skillName: evoseSkill.name,
      mode: 'catalog',
      source: 'default',
      reason: 'no match',
    })

    expect(catalogSegment.content).toContain('<evose-app')
    expect(catalogSegment.content).toContain('<frontmatter>')
    expect(catalogSegment.content).not.toContain('<skill')
  })

  it('still uses <skill> tag for non-Evose skills', () => {
    const skill = createSkill({
      name: 'regular-skill',
      body: 'Do something useful.',
    })

    const segment = buildSkillPromptSegment(skill, {
      skillName: skill.name,
      mode: 'full',
      source: 'explicit',
      reason: 'test',
    })

    expect(segment.content).toContain('<skill')
    expect(segment.content).not.toContain('<evose-app')
  })

  it('renders rules in the same safe structure', () => {
    const rule = createSkill({
      name: 'guard-rails',
      body: 'Never run destructive commands.',
    })

    const segment = buildRulePromptSegment(rule)
    expect(segment.content).toContain('<rule name="guard-rails">')
    expect(segment.content).toContain('<instructions><![CDATA[Never run destructive commands.')
  })
})
