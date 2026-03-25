// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from 'vitest'
import type { CapabilitySnapshot, DocumentCapabilityEntry } from '../../../src/shared/types'
import type { StateRepository, DistributionRecord } from '../../../electron/services/capabilityCenter/stateRepository'
import {
  buildCapabilityPlan,
  type CapabilityPlanRequest,
} from '../../../electron/services/capabilityCenter/sessionInjector'

function createSkill(params: {
  name: string
  scope: 'global' | 'project'
  body?: string
  description?: string
  attributes?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): DocumentCapabilityEntry {
  return {
    kind: 'document',
    name: params.name,
    description: params.description ?? '',
    body: params.body ?? 'Do useful work.',
    attributes: params.attributes ?? {},
    filePath: `/tmp/${params.name}.md`,
    category: 'skill',
    scope: params.scope,
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: params.metadata ?? {},
    importInfo: null,
    distributionInfo: null,
    mountInfo: null,
  }
}

function createSnapshot(skill: DocumentCapabilityEntry): CapabilitySnapshot {
  return {
    skills: [skill],
    agents: [],
    commands: [],
    rules: [],
    hooks: [],
    mcpServers: [],
    diagnostics: [],
    version: Date.now(),
    timestamp: Date.now(),
  }
}

function createDistribution(targetType: string, name: string): DistributionRecord {
  return {
    category: 'skill',
    name,
    targetType,
    targetPath: `/tmp/${name}.md`,
    strategy: 'copy',
    contentHash: 'sha256:test',
    distributedAt: Date.now(),
  }
}

function createRequest(params: {
  engineKind: 'claude' | 'codex'
  explicitSkillNames?: string[]
  implicitQuery?: string
  maxSkillChars?: number
}): CapabilityPlanRequest {
  return {
    session: { engineKind: params.engineKind },
    activation: {
      explicitSkillNames: params.explicitSkillNames,
      implicitQuery: params.implicitQuery,
    },
    policy: {
      maxSkillChars: params.maxSkillChars,
    },
  }
}

describe('buildCapabilityPlan engine-aware distribution filtering', () => {
  it('does not skip codex skills when only claude distribution record exists', async () => {
    const snapshot = createSnapshot(createSkill({ name: 'docs-sync', scope: 'global' }))
    const batchGetDistributions = vi.fn(async (_category: string, names: string[], options?: { targetTypes?: string[] }) => {
      if (names.length === 0) return new Map()
      if (options?.targetTypes?.includes('claude-code-global')) {
        return new Map([['docs-sync', createDistribution('claude-code-global', 'docs-sync')]])
      }
      return new Map()
    })

    const codexPlan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({ engineKind: 'codex' }),
    })
    const claudePlan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({ engineKind: 'claude' }),
    })

    expect(codexPlan.summary.skills).toContain('docs-sync')
    expect(codexPlan.summary.skippedDistributed).toHaveLength(0)
    expect(claudePlan.summary.skills).toHaveLength(0)
    expect(claudePlan.summary.skippedDistributed).toContain('docs-sync')
  })

  it('uses project-scope target mapping for codex sessions', async () => {
    const snapshot = createSnapshot(createSkill({ name: 'ops-runbook', scope: 'project' }))
    const batchGetDistributions = vi.fn(async (_category: string, names: string[], options?: { targetTypes?: string[] }) => {
      if (names.length === 0) return new Map()
      if (options?.targetTypes?.includes('codex-project')) {
        return new Map([['ops-runbook', createDistribution('codex-project', 'ops-runbook')]])
      }
      return new Map()
    })

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({ engineKind: 'codex' }),
    })

    expect(batchGetDistributions).toHaveBeenCalledWith(
      'skill',
      ['ops-runbook'],
      { targetTypes: ['codex-project'] },
    )
    expect(plan.summary.skills).toHaveLength(0)
    expect(plan.summary.skippedDistributed).toContain('ops-runbook')
  })

  it('keeps only explicitly activated skills for codex when activation list is provided', async () => {
    const skillA = createSkill({ name: 'docs-sync', scope: 'global' })
    const skillB = createSkill({ name: 'deploy-check', scope: 'global' })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(skillA),
      skills: [skillA, skillB],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'codex',
        explicitSkillNames: ['deploy-check'],
      }),
    })

    expect(plan.summary.skills).toEqual(['deploy-check'])
    expect(plan.capabilityPrompt).toContain('<skill name="deploy-check" mode="full"')
    expect(plan.capabilityPrompt).not.toContain('docs-sync')
  })

  it('injects frontmatter catalog by default when skill is not explicitly activated', async () => {
    const skill = createSkill({
      name: 'docs-sync',
      scope: 'global',
      body: 'FULL BODY TEXT',
      description: 'Keep docs in sync before edits.',
      attributes: {
        name: 'docs-sync',
        description: 'Keep docs in sync before edits.',
        metadata: {
          tags: ['docs', 'sync'],
        },
      },
    })
    const snapshot = createSnapshot(skill)
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({ engineKind: 'codex' }),
    })

    expect(plan.capabilityPrompt).toContain('<skill name="docs-sync" mode="catalog"')
    expect(plan.capabilityPrompt).toContain('description: Keep docs in sync before edits.')
    expect(plan.capabilityPrompt).not.toContain('FULL BODY TEXT')
  })

  it('upgrades matched skills to full body via implicit activation query', async () => {
    const docsSkill = createSkill({
      name: 'docs-sync',
      scope: 'global',
      body: 'SYNC DOCS BODY',
      description: 'Synchronize docs before final response.',
    })
    const deploySkill = createSkill({
      name: 'deploy-check',
      scope: 'global',
      body: 'DEPLOY CHECK BODY',
      description: 'Pre-deploy checks and safeguards.',
    })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(docsSkill),
      skills: [docsSkill, deploySkill],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'codex',
        implicitQuery: 'please sync docs before output',
      }),
    })

    expect(plan.capabilityPrompt).toContain('<skill name="docs-sync" mode="full"')
    expect(plan.capabilityPrompt).toContain('SYNC DOCS BODY')
    expect(plan.capabilityPrompt).toContain('<skill name="deploy-check" mode="catalog"')
    expect(plan.capabilityPrompt).not.toContain('DEPLOY CHECK BODY')
    expect(plan.summary.skillDecisions.some((item) => item.source === 'implicit' && item.selected)).toBe(true)
  })

  it('still injects full body for always-on skills without slash activation', async () => {
    const skill = createSkill({
      name: 'safety-guard',
      scope: 'global',
      body: 'NEVER EXECUTE DESTRUCTIVE COMMANDS',
      description: 'Critical safety policy.',
      metadata: { always: true },
    })
    const snapshot = createSnapshot(skill)
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({ engineKind: 'codex' }),
    })

    expect(plan.capabilityPrompt).toContain('<skill name="safety-guard" mode="full"')
    expect(plan.capabilityPrompt).toContain('NEVER EXECUTE DESTRUCTIVE COMMANDS')
  })

  it('collects native requirements from explicitly activated Evose skills in full mode', async () => {
    const evoseSkill = createSkill({
      name: 'evose:x_analyst_ja4t9n',
      scope: 'global',
      body: 'Call evose_run_agent with app_id: "agent_123"',
      description: 'Run Evose agent "X Analyst"',
      metadata: { provider: 'evose', appId: 'agent_123', appType: 'agent', gatewayTool: 'evose_run_agent', nativeRequirements: [{ capability: 'evose' }] },
    })
    const regularSkill = createSkill({
      name: 'docs-sync',
      scope: 'global',
      body: 'Sync docs.',
      description: 'Sync documentation.',
    })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(evoseSkill),
      skills: [evoseSkill, regularSkill],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'claude',
        explicitSkillNames: ['evose:x_analyst_ja4t9n'],
      }),
    })

    // Evose skill activated to full mode should produce a native requirement
    expect(plan.nativeRequirements).toBeDefined()
    expect(plan.nativeRequirements.length).toBeGreaterThanOrEqual(1)
    expect(plan.nativeRequirements.some((r) => r.capability === 'evose')).toBe(true)
    // Regular skill should not be in the plan (not explicitly activated)
    expect(plan.summary.skills).not.toContain('docs-sync')
  })

  it('does not collect native requirements from catalog-only Evose skills', async () => {
    const evoseSkill = createSkill({
      name: 'evose:some_agent_abc',
      scope: 'global',
      body: 'Call evose_run_agent with app_id: "agent_456"',
      description: 'Run Evose agent "Some Agent"',
      metadata: { provider: 'evose', appId: 'agent_456', appType: 'agent', gatewayTool: 'evose_run_agent', nativeRequirements: [{ capability: 'evose' }] },
    })
    const snapshot = createSnapshot(evoseSkill)
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'claude',
        // No implicit query, no explicit activation → catalog mode only
      }),
    })

    // Catalog-only Evose skills should NOT produce native requirements
    expect(plan.nativeRequirements).toEqual([])
  })

  it('deduplicates native requirements when multiple Evose skills are activated', async () => {
    const evoseSkillA = createSkill({
      name: 'evose:agent_a',
      scope: 'global',
      body: 'Call evose_run_agent with app_id: "a"',
      metadata: { provider: 'evose', appId: 'a', appType: 'agent', gatewayTool: 'evose_run_agent', nativeRequirements: [{ capability: 'evose' }] },
    })
    const evoseSkillB = createSkill({
      name: 'evose:agent_b',
      scope: 'global',
      body: 'Call evose_run_agent with app_id: "b"',
      metadata: { provider: 'evose', appId: 'b', appType: 'agent', gatewayTool: 'evose_run_agent', nativeRequirements: [{ capability: 'evose' }] },
    })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(evoseSkillA),
      skills: [evoseSkillA, evoseSkillB],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'claude',
        explicitSkillNames: ['evose:agent_a', 'evose:agent_b'],
      }),
    })

    // Both Evose skills activated, but only one { capability: 'evose' } requirement emitted
    const evoseReqs = plan.nativeRequirements.filter((r) => r.capability === 'evose')
    expect(evoseReqs).toHaveLength(1)
  })

  it('ignores malformed nativeRequirements in skill metadata', async () => {
    const badMetaSkill = createSkill({
      name: 'evose:bad_meta',
      scope: 'global',
      body: 'body',
      metadata: { provider: 'evose', nativeRequirements: 'not-an-array' },
    })
    const nullReqSkill = createSkill({
      name: 'evose:null_req',
      scope: 'global',
      body: 'body',
      metadata: { provider: 'evose', nativeRequirements: [null, { capability: 42 }, { noCapField: true }] },
    })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(badMetaSkill),
      skills: [badMetaSkill, nullReqSkill],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'claude',
        explicitSkillNames: ['evose:bad_meta', 'evose:null_req'],
      }),
    })

    // Malformed metadata should not crash — zero valid requirements emitted
    expect(plan.nativeRequirements).toEqual([])
  })

  it('does not collect native requirements from budget-dropped full-mode skills', async () => {
    // Skill A: large Evose skill that fills the budget
    // Skill B: second Evose skill (different capability) that exceeds the budget
    const largeEvoseSkill = createSkill({
      name: 'evose:large_agent',
      scope: 'global',
      body: 'A'.repeat(20_000), // fills most of a 24k codex budget
      metadata: { provider: 'evose', nativeRequirements: [{ capability: 'evose' }] },
    })
    const secondEvoseSkill = createSkill({
      name: 'evose:second_agent',
      scope: 'global',
      body: 'B'.repeat(20_000), // exceeds remaining budget
      metadata: { provider: 'hypothetical', nativeRequirements: [{ capability: 'hypothetical-cap' }] },
    })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(largeEvoseSkill),
      skills: [largeEvoseSkill, secondEvoseSkill],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const plan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'codex', // 24k budget — only fits one large skill
        explicitSkillNames: ['evose:large_agent', 'evose:second_agent'],
      }),
    })

    // First skill fits, second is budget-dropped
    expect(plan.summary.skills).toContain('evose:large_agent')
    expect(plan.summary.skippedByBudget).toContain('evose:second_agent')

    // Only the selected skill's native requirement should be present
    expect(plan.nativeRequirements.some((r) => r.capability === 'evose')).toBe(true)
    expect(plan.nativeRequirements.some((r) => r.capability === 'hypothetical-cap')).toBe(false)
  })

  it('uses a tighter default skill budget for codex than claude when full skill bodies are injected', async () => {
    const largeBodyA = 'A'.repeat(16_000)
    const largeBodyB = 'B'.repeat(16_000)
    const skillA = createSkill({ name: 'alpha', scope: 'global', body: largeBodyA })
    const skillB = createSkill({ name: 'beta', scope: 'global', body: largeBodyB })
    const snapshot: CapabilitySnapshot = {
      ...createSnapshot(skillA),
      skills: [skillA, skillB],
    }
    const batchGetDistributions = vi.fn(async () => new Map())

    const codexPlan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'codex',
        explicitSkillNames: ['alpha', 'beta'],
      }),
    })
    const claudePlan = await buildCapabilityPlan({
      snapshot,
      stateRepo: { batchGetDistributions } as unknown as StateRepository,
      request: createRequest({
        engineKind: 'claude',
        explicitSkillNames: ['alpha', 'beta'],
      }),
    })

    expect(codexPlan.summary.skills).toEqual(['alpha'])
    expect(claudePlan.summary.skills).toEqual(['alpha', 'beta'])
  })
})
