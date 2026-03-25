// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { EvoseSkillProvider } from '../../../electron/services/capabilityCenter/evoseSkillProvider'
import type { EvoseSettings } from '@shared/types'

function makeSettings(overrides?: Partial<EvoseSettings>): EvoseSettings {
  return {
    apiKey: 'k',
    baseUrl: 'https://api.example.com',
    workspaceIds: ['ws-1'],
    apps: [],
    ...overrides,
  }
}

describe('EvoseSkillProvider', () => {
  it('projects agent app into a virtual skill entry', () => {
    const settings = makeSettings({
      apps: [
        {
          appId: 'agent_123',
          name: 'Customer Support',
          type: 'agent',
          enabled: true,
          description: 'Answer customer support questions',
        },
      ],
    })
    const provider = new EvoseSkillProvider(() => settings)

    const [entry] = provider.projectSkills(new Map())

    expect(entry).toBeDefined()
    expect(entry.name.startsWith('evose:')).toBe(true)
    expect(entry.filePath).toBe('evose://skill/agent_123')
    expect(entry.description).toContain('Answer customer support questions')
    expect(entry.description).toContain('evose_run_agent')
    expect(entry.enabled).toBe(true)
    expect(entry.mountInfo?.namespace).toBe('evose')
    expect(entry.body).toContain('evose_run_agent')
    expect(entry.body).toContain('app_id: "agent_123"')
    expect(entry.body).toContain('Do NOT use the Skill tool')
    // Self-declared native requirements for the session orchestrator
    expect(entry.metadata?.['nativeRequirements']).toEqual([{ capability: 'evose' }])
  })

  it('applies persisted toggle state but still respects app-level disable', () => {
    const settings = makeSettings({
      apps: [
        {
          appId: 'workflow_1',
          name: 'Data Pipeline',
          type: 'workflow',
          enabled: false,
          description: 'Transform source data',
        },
      ],
    })
    const provider = new EvoseSkillProvider(() => settings)
    const [first] = provider.projectSkills(new Map())
    const toggles = new Map([[first.name, { enabled: true, tags: ['critical'] }]])

    const [entry] = provider.projectSkills(toggles)

    expect(entry.enabled).toBe(false)
    expect(entry.tags).toEqual(['critical'])
    expect(entry.body).toContain('evose_run_workflow')
  })

  it('returns virtual source markdown for projected skills', () => {
    const settings = makeSettings({
      apps: [
        {
          appId: 'agent_xyz',
          name: 'X Analyst',
          type: 'agent',
          enabled: true,
          description: '',
        },
      ],
    })
    const provider = new EvoseSkillProvider(() => settings)

    const content = provider.readVirtualSource('evose://skill/agent_xyz')

    expect(content).toBeTruthy()
    expect(content).toContain('---')
    expect(content).toContain('evose_run_agent')
  })

  it('returns null for unknown virtual source paths', () => {
    const provider = new EvoseSkillProvider(() => makeSettings())

    expect(provider.readVirtualSource('evose://skill/not-found')).toBeNull()
    expect(provider.readVirtualSource('/tmp/skill.md')).toBeNull()
  })

  it('declares app display name as alias for implicit matching', () => {
    const settings = makeSettings({
      apps: [
        {
          appId: 'agent_abc',
          name: 'X Analyst',
          type: 'agent',
          enabled: true,
          description: '',
        },
      ],
    })
    const provider = new EvoseSkillProvider(() => settings)

    const [entry] = provider.projectSkills(new Map())

    // The internal name contains the namespace prefix and hash suffix
    expect(entry.name).toMatch(/^evose:/)
    expect(entry.name).not.toBe('X Analyst')

    // The original display name is declared as an alias so implicit matching
    // can find this skill when users reference it by its human-facing name.
    expect(entry.attributes['aliases']).toEqual(['X Analyst'])
  })
})
