// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  normalizeHeading,
  extractSections,
  validateSections,
  parseCapabilityOutput,
  extractLatestCapabilityOutput,
  type SectionValidation,
} from '@shared/capabilityOutputParser'
import {
  RULE_TEMPLATE,
  SKILL_TEMPLATE,
  AGENT_TEMPLATE,
  COMMAND_TEMPLATE,
  getTemplate,
  FENCE_TYPES,
  TAG_TO_CATEGORY,
  ALL_FENCE_TAGS,
} from '@shared/capabilityTemplates'
import type { ManagedSessionMessage } from '@shared/types'

// ═══════════════════════════════════════════════════════════════════
// normalizeHeading
// ═══════════════════════════════════════════════════════════════════

describe('normalizeHeading', () => {
  it('lowercases text', () => {
    expect(normalizeHeading('Purpose')).toBe('purpose')
    expect(normalizeHeading('GUIDELINES')).toBe('guidelines')
  })

  it('replaces & with and', () => {
    expect(normalizeHeading('Role & Expertise')).toBe('role and expertise')
  })

  it('collapses multiple spaces', () => {
    expect(normalizeHeading('Role   &   Expertise')).toBe('role and expertise')
  })

  it('trims whitespace', () => {
    expect(normalizeHeading('  Purpose  ')).toBe('purpose')
  })

  it('normalizes "Role and Expertise" same as "Role & Expertise"', () => {
    expect(normalizeHeading('Role and Expertise')).toBe(normalizeHeading('Role & Expertise'))
  })
})

// ═══════════════════════════════════════════════════════════════════
// extractSections
// ═══════════════════════════════════════════════════════════════════

describe('extractSections', () => {
  it('extracts simple ## headings with content (keys are normalized)', () => {
    const body = `## Purpose\nKeep code clean.\n\n## Guidelines\n- Use TypeScript\n- Lint always`
    const sections = extractSections(body)

    expect(sections.size).toBe(2)
    expect(sections.get('purpose')).toBe('Keep code clean.')
    expect(sections.get('guidelines')).toBe('- Use TypeScript\n- Lint always')
  })

  it('ignores # title headings (level 1)', () => {
    const body = `# Title\nSome intro\n## Purpose\nActual section`
    const sections = extractSections(body)

    expect(sections.size).toBe(1)
    expect(sections.get('purpose')).toBe('Actual section')
    expect(sections.has('title')).toBe(false)
  })

  it('ignores ### sub-headings (level 3+)', () => {
    const body = `## Overview\nIntro here\n### Detail\nSub detail\n## Instructions\nStep 1`
    const sections = extractSections(body)

    expect(sections.size).toBe(2)
    expect(sections.get('overview')).toBe('Intro here\n### Detail\nSub detail')
    expect(sections.get('instructions')).toBe('Step 1')
  })

  it('returns empty map for body without ## headings', () => {
    const body = `Just some plain text\nwithout any headings`
    const sections = extractSections(body)
    expect(sections.size).toBe(0)
  })

  it('handles empty body', () => {
    expect(extractSections('').size).toBe(0)
  })

  it('handles heading with empty content', () => {
    const body = `## Purpose\n\n## Guidelines\nSome content`
    const sections = extractSections(body)

    expect(sections.size).toBe(2)
    expect(sections.get('purpose')).toBe('')  // empty content
    expect(sections.get('guidelines')).toBe('Some content')
  })

  it('normalizes heading keys (& → and, case-insensitive)', () => {
    const body = `## Role & Expertise\nContent here`
    const sections = extractSections(body)

    // Key is normalized
    expect(sections.has('role and expertise')).toBe(true)
    expect(sections.get('role and expertise')).toBe('Content here')
  })

  it('trims whitespace around heading text', () => {
    const body = `##   Spaced Heading  \nContent`
    const sections = extractSections(body)

    expect(sections.has('spaced heading')).toBe(true)
  })

  it('handles content before any heading', () => {
    const body = `Some preamble\n\n## First\nContent`
    const sections = extractSections(body)

    // Preamble before any heading is not captured
    expect(sections.size).toBe(1)
    expect(sections.get('first')).toBe('Content')
  })
})

// ═══════════════════════════════════════════════════════════════════
// validateSections
// ═══════════════════════════════════════════════════════════════════

describe('validateSections', () => {
  describe('rule template', () => {
    it('marks complete when all required sections present', () => {
      const body = `## Purpose\nPrevent bugs\n\n## Guidelines\n- Lint all code`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(true)
      expect(result.missingRequired).toEqual([])
      expect(result.present).toContain('Purpose')
      expect(result.present).toContain('Guidelines')
    })

    it('marks complete with optional Examples section', () => {
      const body = `## Purpose\nPrevent bugs\n\n## Guidelines\n- Lint\n\n## Examples\nGood: x\nBad: y`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(true)
      expect(result.present).toContain('Examples')
    })

    it('detects missing required Purpose section', () => {
      const body = `## Guidelines\n- Lint all code`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(false)
      expect(result.missingRequired).toEqual(['Purpose'])
    })

    it('detects missing required Guidelines section', () => {
      const body = `## Purpose\nPrevent bugs`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(false)
      expect(result.missingRequired).toEqual(['Guidelines'])
    })

    it('detects empty required section as missing', () => {
      const body = `## Purpose\n\n## Guidelines\n- Lint`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(false)
      expect(result.missingRequired).toEqual(['Purpose'])
    })

    it('does not flag missing optional section', () => {
      // Examples is optional — omitting it is fine
      const body = `## Purpose\nPrevent bugs\n\n## Guidelines\n- Lint`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(true)
      expect(result.missingRequired).toEqual([])
      expect(result.present).not.toContain('Examples')
    })
  })

  describe('skill template', () => {
    it('marks complete with Overview + Instructions', () => {
      const body = `## Overview\nDoes X\n\n## Instructions\n1. Do Y`
      const result = validateSections(body, SKILL_TEMPLATE)

      expect(result.isComplete).toBe(true)
      expect(result.missingRequired).toEqual([])
    })

    it('detects missing Instructions', () => {
      const body = `## Overview\nDoes X`
      const result = validateSections(body, SKILL_TEMPLATE)

      expect(result.isComplete).toBe(false)
      expect(result.missingRequired).toEqual(['Instructions'])
    })
  })

  describe('agent template', () => {
    it('requires all three sections', () => {
      const body = `## Role & Expertise\nExpert\n\n## Communication Style\nFormal\n\n## Guidelines\nBe careful`
      const result = validateSections(body, AGENT_TEMPLATE)

      expect(result.isComplete).toBe(true)
      expect(result.present).toHaveLength(3)
    })

    it('detects multiple missing required sections', () => {
      const body = `## Role & Expertise\nExpert`
      const result = validateSections(body, AGENT_TEMPLATE)

      expect(result.isComplete).toBe(false)
      expect(result.missingRequired).toContain('Communication Style')
      expect(result.missingRequired).toContain('Guidelines')
    })
  })

  describe('command template', () => {
    it('marks complete with required sections', () => {
      const body = `## What This Command Does\nDeploys code\n\n## Steps\n1. Build\n2. Deploy`
      const result = validateSections(body, COMMAND_TEMPLATE)

      expect(result.isComplete).toBe(true)
    })
  })

  it('handles empty body as all-missing', () => {
    const result = validateSections('', RULE_TEMPLATE)

    expect(result.isComplete).toBe(false)
    expect(result.missingRequired).toEqual(['Purpose', 'Guidelines'])
    expect(result.present).toEqual([])
  })

  describe('heading normalization tolerance', () => {
    it('matches "Role and Expertise" against template "Role & Expertise"', () => {
      const body = `## Role and Expertise\nExpert\n\n## Communication Style\nFormal\n\n## Guidelines\nRules`
      const result = validateSections(body, AGENT_TEMPLATE)

      expect(result.isComplete).toBe(true)
      expect(result.present).toContain('Role & Expertise')
    })

    it('matches lowercase headings', () => {
      const body = `## purpose\nPrevent bugs\n\n## guidelines\n- Lint`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(true)
    })

    it('matches UPPERCASE headings', () => {
      const body = `## PURPOSE\nPrevent bugs\n\n## GUIDELINES\n- Lint`
      const result = validateSections(body, RULE_TEMPLATE)

      expect(result.isComplete).toBe(true)
    })

    it('matches headings with extra whitespace', () => {
      const body = `## Role  &  Expertise\nExpert\n\n## Communication  Style\nFormal\n\n## Guidelines\nRules`
      const result = validateSections(body, AGENT_TEMPLATE)

      expect(result.isComplete).toBe(true)
    })

    it('returns canonical template heading names in present/missing arrays', () => {
      // Even though body has "role and expertise", present[] should say "Role & Expertise"
      const body = `## role and expertise\nExpert`
      const result = validateSections(body, AGENT_TEMPLATE)

      expect(result.present).toEqual(['Role & Expertise'])
      expect(result.missingRequired).toContain('Communication Style')
      expect(result.missingRequired).toContain('Guidelines')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════
// parseCapabilityOutput
// ═══════════════════════════════════════════════════════════════════

describe('parseCapabilityOutput', () => {
  it('parses a complete rule output', () => {
    const text = [
      '```rule-output',
      '---',
      'name: typescript-conventions',
      'description: TypeScript coding standards',
      '---',
      '',
      '# TypeScript Conventions',
      '',
      '## Purpose',
      'Ensures consistent TypeScript code across the project.',
      '',
      '## Guidelines',
      '- Use strict mode',
      '- Prefer interfaces over types',
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text, 'rule')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('rule')
    expect(result!.name).toBe('typescript-conventions')
    expect(result!.description).toBe('TypeScript coding standards')
    expect(result!.isPartial).toBeUndefined()
    expect(result!.missingSections).toBeUndefined()
  })

  it('detects partial output with missing required sections', () => {
    const text = [
      '```rule-output',
      '---',
      'name: my-rule',
      'description: A rule',
      '---',
      '',
      '# My Rule',
      '',
      '## Purpose',
      'Some purpose here.',
      // Guidelines section is missing!
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text, 'rule')
    expect(result).not.toBeNull()
    expect(result!.isPartial).toBe(true)
    expect(result!.missingSections).toEqual(['Guidelines'])
  })

  it('detects unclosed fence as partial', () => {
    const text = [
      '```rule-output',
      '---',
      'name: my-rule',
      'description: A rule',
      '---',
      '',
      '## Purpose',
      'Some purpose.',
      '## Guidelines',
      '- Do this',
      // No closing ``` — fence never closed
    ].join('\n')

    const result = parseCapabilityOutput(text, 'rule', { allowUnclosed: true })
    expect(result).not.toBeNull()
    expect(result!.isPartial).toBe(true)
  })

  it('returns null when name is missing', () => {
    const text = [
      '```rule-output',
      '---',
      'description: No name here',
      '---',
      '## Purpose',
      'Why',
      '## Guidelines',
      '- What',
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text)
    expect(result).toBeNull()
  })

  it('parses agent output with model and color', () => {
    const text = [
      '```agent-output',
      '---',
      'name: code-reviewer',
      'description: Reviews code',
      'model: sonnet',
      "color: '#8B5CF6'",
      '---',
      '',
      '## Role & Expertise',
      'Expert code reviewer.',
      '',
      '## Communication Style',
      'Direct and constructive.',
      '',
      '## Guidelines',
      '- Focus on logic errors',
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text, 'agent')
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('agent')
    expect(result!.model).toBe('sonnet')
    expect(result!.color).toBe('#8B5CF6')
    expect(result!.isPartial).toBeUndefined()
  })

  it('parses command output with argument-hint', () => {
    const text = [
      '```command-output',
      '---',
      'name: deploy-staging',
      'description: Deploy to staging',
      'argument-hint: <env> [--force]',
      '---',
      '',
      '## What This Command Does',
      'Deploys the app to staging.',
      '',
      '## Steps',
      '1. Build the app',
      '2. Push to staging',
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text, 'command')
    expect(result).not.toBeNull()
    expect(result!.argumentHint).toBe('<env> [--force]')
    expect(result!.isPartial).toBeUndefined()
  })

  it('parses without category filter (auto-detects from fence tag)', () => {
    const text = [
      '```skill-output',
      '---',
      'name: code-review',
      'description: Reviews code',
      '---',
      '',
      '## Overview',
      'Automated code review.',
      '',
      '## Instructions',
      '1. Read the file',
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text)
    expect(result).not.toBeNull()
    expect(result!.kind).toBe('skill')
  })

  it('returns last fence when multiple exist', () => {
    const text = [
      '```rule-output',
      '---',
      'name: old-version',
      'description: First try',
      '---',
      '## Purpose',
      'Old',
      '## Guidelines',
      '- Old rule',
      '```',
      '',
      'Let me revise that:',
      '',
      '```rule-output',
      '---',
      'name: new-version',
      'description: Revised',
      '---',
      '## Purpose',
      'New purpose',
      '## Guidelines',
      '- New rule',
      '```',
    ].join('\n')

    const result = parseCapabilityOutput(text, 'rule')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('new-version')
  })
})

// ═══════════════════════════════════════════════════════════════════
// extractLatestCapabilityOutput (from messages)
// ═══════════════════════════════════════════════════════════════════

describe('extractLatestCapabilityOutput', () => {
  function makeMessage(role: 'user' | 'assistant', text: string): ManagedSessionMessage {
    return {
      role,
      content: [{ type: 'text', text }],
    } as ManagedSessionMessage
  }

  it('extracts from assistant messages', () => {
    const messages: ManagedSessionMessage[] = [
      makeMessage('user', 'Create a rule'),
      makeMessage('assistant', [
        '```rule-output',
        '---',
        'name: test-rule',
        'description: A test',
        '---',
        '## Purpose',
        'Testing.',
        '## Guidelines',
        '- Test everything',
        '```',
      ].join('\n')),
    ]

    const result = extractLatestCapabilityOutput(messages, 'rule')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('test-rule')
  })

  it('returns null when no capability output in messages', () => {
    const messages: ManagedSessionMessage[] = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi! What would you like to create?'),
    ]

    const result = extractLatestCapabilityOutput(messages, 'rule')
    expect(result).toBeNull()
  })

  it('detects partial output with missing sections', () => {
    const messages: ManagedSessionMessage[] = [
      makeMessage('assistant', [
        '```skill-output',
        '---',
        'name: my-skill',
        'description: Does stuff',
        '---',
        '## Overview',
        'This skill does stuff.',
        // Instructions section is missing
        '```',
      ].join('\n')),
    ]

    const result = extractLatestCapabilityOutput(messages, 'skill')
    expect(result).not.toBeNull()
    expect(result!.isPartial).toBe(true)
    expect(result!.missingSections).toEqual(['Instructions'])
  })
})

// ═══════════════════════════════════════════════════════════════════
// capabilityTemplates — fence type constants
// ═══════════════════════════════════════════════════════════════════

describe('capabilityTemplates constants', () => {
  it('FENCE_TYPES maps all categories', () => {
    expect(FENCE_TYPES.skill).toBe('skill-output')
    expect(FENCE_TYPES.agent).toBe('agent-output')
    expect(FENCE_TYPES.command).toBe('command-output')
    expect(FENCE_TYPES.rule).toBe('rule-output')
  })

  it('TAG_TO_CATEGORY is the reverse of FENCE_TYPES', () => {
    expect(TAG_TO_CATEGORY['skill-output']).toBe('skill')
    expect(TAG_TO_CATEGORY['agent-output']).toBe('agent')
    expect(TAG_TO_CATEGORY['command-output']).toBe('command')
    expect(TAG_TO_CATEGORY['rule-output']).toBe('rule')
  })

  it('ALL_FENCE_TAGS contains all fence type values', () => {
    expect(ALL_FENCE_TAGS).toHaveLength(4)
    expect(ALL_FENCE_TAGS).toContain('skill-output')
    expect(ALL_FENCE_TAGS).toContain('agent-output')
    expect(ALL_FENCE_TAGS).toContain('command-output')
    expect(ALL_FENCE_TAGS).toContain('rule-output')
  })

  it('getTemplate returns correct template for each category', () => {
    expect(getTemplate('rule')).toBe(RULE_TEMPLATE)
    expect(getTemplate('skill')).toBe(SKILL_TEMPLATE)
    expect(getTemplate('agent')).toBe(AGENT_TEMPLATE)
    expect(getTemplate('command')).toBe(COMMAND_TEMPLATE)
  })

  it('all templates have at least 2 required sections', () => {
    for (const cat of ['rule', 'skill', 'agent', 'command'] as const) {
      const template = getTemplate(cat)
      const required = template.sections.filter(s => s.required)
      expect(required.length).toBeGreaterThanOrEqual(2)
    }
  })
})
