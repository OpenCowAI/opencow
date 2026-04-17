// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import type { DocumentCapabilityEntry } from '../../../src/shared/types'
import {
  resolveSkillActivationDecisions,
  resolveSkillActivationPolicy,
} from '../../../electron/services/capabilityCenter/skillActivationEngine'

function createSkill(params: {
  name: string
  description?: string
  attributes?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): DocumentCapabilityEntry {
  return {
    kind: 'document',
    name: params.name,
    description: params.description ?? '',
    body: 'body',
    attributes: params.attributes ?? {},
    filePath: `/tmp/${params.name}.md`,
    category: 'skill',
    scope: 'global',
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: params.metadata ?? {},
    importInfo: null,
    distributionInfo: null,
    mountInfo: null,
  }
}

describe('skillActivationEngine', () => {
  it('keeps skills in catalog mode when only implicit query is provided', () => {
    const skills = [
      createSkill({ name: 'docs-sync', description: 'sync docs before output' }),
      createSkill({ name: 'deploy-check', description: 'run deployment checks' }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(),
        agentSkillNames: new Set(),
        implicitQuery: 'please sync docs before output',
      },
      resolveSkillActivationPolicy(),
    )

    const docsDecision = decisions.find((item) => item.skillName === 'docs-sync')
    const deployDecision = decisions.find((item) => item.skillName === 'deploy-check')

    expect(docsDecision?.mode).toBe('catalog')
    expect(docsDecision?.source).toBe('default')
    expect(deployDecision?.mode).toBe('catalog')
    expect(deployDecision?.source).toBe('default')
  })

  it('does not run implicit matching when explicit list is present', () => {
    const skills = [
      createSkill({ name: 'docs-sync', description: 'sync docs before output' }),
      createSkill({ name: 'deploy-check', description: 'run deployment checks' }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(['deploy-check']),
        agentSkillNames: new Set(),
        implicitQuery: 'please sync docs before output',
      },
      resolveSkillActivationPolicy(),
    )

    const docsDecision = decisions.find((item) => item.skillName === 'docs-sync')
    const deployDecision = decisions.find((item) => item.skillName === 'deploy-check')

    expect(docsDecision?.source).toBe('default')
    expect(deployDecision?.source).toBe('explicit')
  })

  it('always-on metadata has highest priority', () => {
    const skills = [
      createSkill({
        name: 'safety-guard',
        metadata: { always: true },
      }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(),
        agentSkillNames: new Set(),
      },
      resolveSkillActivationPolicy(),
    )

    expect(decisions[0]).toMatchObject({
      skillName: 'safety-guard',
      mode: 'full',
      source: 'always',
    })
  })

  // Implicit alias/name matching is intentionally disabled in Phase 1B.11d.

  it('does not activate skill via alias phrase when internal name diverges', () => {
    // Simulates an Evose skill whose internal name includes a namespace prefix
    // and hash suffix, but whose alias is the human-readable display name.
    // The provider (EvoseSkillProvider) populates attributes.aliases.
    const skills = [
      createSkill({
        name: 'evose:x_analyst_ja4t9n',
        description: 'Run Evose agent "X Analyst" via the gateway tool.',
        attributes: { aliases: ['X Analyst'] },
        metadata: {
          provider: 'evose',
          appId: '92226822732779520',
          appType: 'agent',
          gatewayTool: 'evose_run_agent',
        },
      }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(),
        agentSkillNames: new Set(),
        implicitQuery: '使用 X Analyst 简单分析近一周热点 AI Agent 产品',
      },
      resolveSkillActivationPolicy(),
    )

    expect(decisions[0]).toMatchObject({
      skillName: 'evose:x_analyst_ja4t9n',
      mode: 'catalog',
      source: 'default',
    })
    expect(decisions[0].reason).toContain('default catalog projection')
  })

  it('does not match when neither internal name nor alias appears in query', () => {
    const skills = [
      createSkill({
        name: 'evose:x_analyst_ja4t9n',
        description: 'Run Evose agent "X Analyst" via the gateway tool.',
        attributes: { aliases: ['X Analyst'] },
      }),
      createSkill({
        name: 'evose:image_creator_7lv1rz',
        description: 'Run Evose workflow "Image Creator" via the gateway tool.',
        attributes: { aliases: ['Image Creator'] },
      }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(),
        agentSkillNames: new Set(),
        implicitQuery: '帮我创建一张产品宣传海报',
      },
      resolveSkillActivationPolicy(),
    )

    const xAnalyst = decisions.find((d) => d.skillName === 'evose:x_analyst_ja4t9n')
    expect(xAnalyst?.mode).toBe('catalog')
  })

  it('does not activate skill when multi-word alias appears in Chinese context', () => {
    const skills = [
      createSkill({
        name: 'evose:demo_redbook_agent_4fwwv5',
        description: 'Run Evose agent "Demo RedBook Agent" via the gateway tool.',
        attributes: { aliases: ['Demo RedBook Agent'] },
      }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(),
        agentSkillNames: new Set(),
        implicitQuery: '用 Demo RedBook Agent 帮我写一条小红书笔记',
      },
      resolveSkillActivationPolicy(),
    )

    expect(decisions[0]).toMatchObject({ mode: 'catalog', source: 'default' })
  })

  it('does not activate skill when alias appears in an English query', () => {
    const skills = [
      createSkill({
        name: 'evose:native_english_coach_vw7ecv',
        description: 'Native English conversation coach',
        attributes: { aliases: ['Native English Coach'] },
      }),
    ]

    const decisions = resolveSkillActivationDecisions(
      skills,
      {
        explicitSkillNames: new Set(),
        agentSkillNames: new Set(),
        implicitQuery: 'I want to practice with Native English Coach',
      },
      resolveSkillActivationPolicy(),
    )

    expect(decisions[0]).toMatchObject({ mode: 'catalog', source: 'default' })
    expect(decisions[0].reason).toContain('default catalog projection')
  })
})
