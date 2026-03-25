// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { decideSessionReconfiguration } from '../../../electron/command/policy/sessionReconfigurationCoordinator'
import type { CapabilitySnapshot, DocumentCapabilityEntry, StartSessionPolicy } from '../../../src/shared/types'

// ── Helpers ──────────────────────────────────────────────────────────────

function makePolicy(overrides?: Partial<StartSessionPolicy>): StartSessionPolicy {
  return {
    tools: {
      builtin: { enabled: true },
      native: { mode: 'none', allow: [] },
    },
    capabilities: {
      skill: { maxChars: 24000, explicit: [] },
    },
    ...overrides,
  }
}

function makePolicyWithEvose(): StartSessionPolicy {
  return makePolicy({
    tools: {
      builtin: { enabled: true },
      native: { mode: 'allowlist', allow: [{ capability: 'evose' }] },
    },
  })
}

function makeEvoseSkillEntry(name: string, alias: string): DocumentCapabilityEntry {
  return {
    kind: 'document',
    name,
    description: `Run Evose agent "${alias}"`,
    body: '',
    attributes: { aliases: [alias], tags: ['evose', 'agent'], keywords: ['evose', 'agent'] },
    filePath: `evose://${name}`,
    category: 'skill',
    scope: 'global',
    enabled: true,
    tags: ['evose'],
    eligibility: { eligible: true },
    metadata: { nativeRequirements: [{ capability: 'evose' }] },
  }
}

function makeEmptySnapshot(): CapabilitySnapshot {
  return {
    skills: [],
    agents: [],
    commands: [],
    rules: [],
    hooks: [],
    mcpServers: [],
    diagnostics: [],
    version: 1,
    timestamp: Date.now(),
  }
}

function makeSnapshotWithEvoseSkills(): CapabilitySnapshot {
  return {
    ...makeEmptySnapshot(),
    skills: [
      makeEvoseSkillEntry('evose:x_analyst_ja4t9n', 'X Analyst'),
      makeEvoseSkillEntry('evose:demo_assistant_hxpylx', 'Demo Assistant'),
    ],
  }
}

// ── Phase 1: Explicit requirements (slash commands) ──────────────────────

describe('sessionReconfigurationCoordinator', () => {
  describe('Phase 1: explicit native requirements', () => {
    it('reuses lifecycle when message has no native requirements', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: 'hello',
      })

      expect(decision.action).toBe('reuse')
      expect(decision.reason).toBe('no_native_requirements')
    })

    it('restarts lifecycle when required native capability is missing', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: [
          {
            type: 'slash_command',
            name: 'evose:agent_github_iab8p2',
            category: 'skill',
            label: 'Agent - Github',
            execution: {
              nativeRequirements: [{ capability: 'evose' }],
              providerExecution: {
                provider: 'evose',
                appId: 'agent_github_iab8p2',
                appType: 'agent',
                gatewayTool: 'evose_run_agent',
              },
            },
            expandedText: 'run evose',
          },
        ],
      })

      expect(decision.action).toBe('restart')
      expect(decision.reason).toBe('native_mode_none')
      expect(decision.triggeringRequirements).toEqual([{ capability: 'evose' }])
    })

    it('reuses lifecycle when required native capability is already allowlisted', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicyWithEvose(),
        message: [
          {
            type: 'slash_command',
            name: 'evose:agent_github_iab8p2',
            category: 'skill',
            label: 'Agent - Github',
            execution: {
              nativeRequirements: [{ capability: 'evose' }],
              providerExecution: {
                provider: 'evose',
                appId: 'agent_github_iab8p2',
                appType: 'agent',
                gatewayTool: 'evose_run_agent',
              },
            },
            expandedText: 'run evose',
          },
        ],
      })

      expect(decision.action).toBe('reuse')
      expect(decision.reason).toBe('native_allowlist_satisfied')
    })
  })

  // ── Phase 2: Implicit requirements (plain-text skill references) ─────

  describe('Phase 2: implicit native requirements', () => {
    it('restarts lifecycle when plain text mentions an evose app by alias', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: '请使用 X Analyst 分析一下 @elonmusk',
        capabilitySnapshot: makeSnapshotWithEvoseSkills(),
      })

      expect(decision.action).toBe('restart')
      expect(decision.reason).toBe('implicit_native_requirements_not_satisfied')
      expect(decision.triggeringRequirements).toEqual([{ capability: 'evose' }])
    })

    it('reuses lifecycle when evose is already in allowlist', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicyWithEvose(),
        message: '请使用 X Analyst 分析一下 @elonmusk',
        capabilitySnapshot: makeSnapshotWithEvoseSkills(),
      })

      expect(decision.action).toBe('reuse')
      expect(decision.reason).toBe('native_allowlist_satisfied')
    })

    it('reuses lifecycle when plain text does not match any skill', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: 'what is the weather today?',
        capabilitySnapshot: makeSnapshotWithEvoseSkills(),
      })

      expect(decision.action).toBe('reuse')
      expect(decision.reason).toBe('no_native_requirements')
    })

    it('skips implicit matching when no capabilitySnapshot is provided', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: '请使用 X Analyst 分析一下 @elonmusk',
        // No capabilitySnapshot — implicit matching cannot run
      })

      expect(decision.action).toBe('reuse')
      expect(decision.reason).toBe('no_native_requirements')
    })

    it('skips implicit matching when snapshot has no skills with native requirements', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: '请使用 X Analyst 分析一下',
        capabilitySnapshot: makeEmptySnapshot(),
      })

      expect(decision.action).toBe('reuse')
      expect(decision.reason).toBe('no_native_requirements')
    })

    it('restarts when policy is missing and implicit requirements are found', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: undefined,
        message: '请使用 Demo Assistant',
        capabilitySnapshot: makeSnapshotWithEvoseSkills(),
      })

      expect(decision.action).toBe('restart')
      expect(decision.reason).toBe('implicit_native_requirements_policy_missing')
    })

    it('explicit requirements take priority over implicit (Phase 1 short-circuits)', () => {
      const decision = decideSessionReconfiguration({
        currentPolicy: makePolicy(),
        message: [
          {
            type: 'slash_command',
            name: 'evose:x_analyst_ja4t9n',
            category: 'skill',
            label: 'X Analyst',
            execution: {
              nativeRequirements: [{ capability: 'evose' }],
              providerExecution: {
                provider: 'evose',
                appId: 'x_analyst_ja4t9n',
                appType: 'agent',
                gatewayTool: 'evose_run_agent',
              },
            },
            expandedText: 'run evose',
          },
        ],
        capabilitySnapshot: makeSnapshotWithEvoseSkills(),
      })

      // Should use explicit reason, not implicit
      expect(decision.action).toBe('restart')
      expect(decision.reason).toBe('native_mode_none')
    })
  })
})
