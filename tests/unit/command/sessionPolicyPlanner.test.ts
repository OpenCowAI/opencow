// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  planSessionPolicy,
  policySatisfiesRequiredNativeAllowlist,
} from '../../../electron/command/policy/sessionPolicyPlanner'

describe('sessionPolicyPlanner', () => {
  it('plans policy from prompt execution contract and injects native allowlist', () => {
    const plan = planSessionPolicy({
      origin: { source: 'issue', issueId: 'issue-1' },
      prompt: [
        { type: 'text', text: '请调用 evose app' },
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
          expandedText: 'Use this capability to run Evose Agent "Agent - Github".',
        },
      ],
    })

    expect(plan.activation.explicitSkillNames).toEqual(['evose:agent_github_iab8p2'])
    expect(plan.activation.requiredNativeAllowlist).toEqual([{ capability: 'evose' }])
    expect(plan.effectivePolicy.tools.native.mode).toBe('allowlist')
    // issue origin defaults include browser + html; evose is appended from slash command
    expect(plan.effectivePolicy.tools.native.allow).toEqual([
      { capability: 'browser' },
      { capability: 'html' },
      { capability: 'interaction' },
      { capability: 'issues' },
      { capability: 'projects' },
      { capability: 'schedules' },
      { capability: 'evose' },
    ])
  })

  it('matches required native allowlist against effective policy', () => {
    expect(
      policySatisfiesRequiredNativeAllowlist(
        {
          tools: {
            builtin: { enabled: true },
            native: {
              mode: 'allowlist',
              allow: [{ capability: 'evose' }],
            },
          },
          capabilities: {
            skill: {
              maxChars: 24000,
              explicit: [],
            },
          },
        },
        [{ capability: 'evose', tool: 'evose_run_agent' }],
      ),
    ).toBe(true)
  })
})
