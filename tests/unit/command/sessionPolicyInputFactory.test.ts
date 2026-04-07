// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSessionPolicyInput } from '../../../electron/command/policy/sessionPolicyInputFactory'

describe('buildSessionPolicyInput', () => {
  // ── General-purpose origins (agent, issue): browser default-on ─────

  it('applies browser and html native tools for agent origin by default', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'agent' },
    })

    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [
            { capability: 'browser' },
            { capability: 'html' },
            { capability: 'interaction', tool: 'ask_user_question' },
            { capability: 'issues', tool: 'propose_issue_operation' },
            { capability: 'schedules', tool: 'propose_schedule_operation' },
          ],
        },
      },
    })
  })

  it('applies browser and html native tools for issue origin by default', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'issue', issueId: 'issue-1' },
    })

    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [
            { capability: 'browser' },
            { capability: 'html' },
            { capability: 'interaction', tool: 'ask_user_question' },
            { capability: 'issues', tool: 'propose_issue_operation' },
            { capability: 'schedules', tool: 'propose_schedule_operation' },
          ],
        },
      },
    })
  })

  it('merges agent defaults with explicit policy (override wins for native allow)', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'agent' },
      policy: {
        tools: {
          native: {
            mode: 'allowlist',
            allow: [{ capability: 'issues' }],
          },
        },
      },
    })

    // Explicit override replaces default native allow
    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [{ capability: 'issues' }],
        },
      },
    })
  })

  it('does not disable builtin tools for agent origin', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'agent' },
    })

    // builtin should NOT be present (default true), unlike browser-agent which sets false
    expect(policy?.tools?.builtin).toBeUndefined()
  })

  // ── Specialised browser-agent origin ──────────────────────────────

  it('applies browser-agent defaults when policy is absent', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'browser-agent' },
    })

    expect(policy).toEqual({
      tools: {
        builtin: { enabled: false },
        native: {
          mode: 'allowlist',
          allow: [{ capability: 'browser' }],
        },
      },
    })
  })

  it('merges browser-agent defaults with explicit policy overrides', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'browser-agent' },
      policy: {
        tools: {
          native: {
            allow: [{ capability: 'issues', tool: 'list_issues' }],
          },
        },
      },
    })

    expect(policy).toEqual({
      tools: {
        builtin: { enabled: false },
        native: {
          mode: 'allowlist',
          allow: [{ capability: 'issues', tool: 'list_issues' }],
        },
      },
    })
  })

  // ── Market analyzer origin ────────────────────────────────────────

  it('applies market-analyzer defaults when policy is absent', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'market-analyzer', slug: 'foo/bar', marketplaceId: 'market-1' },
    })

    expect(policy).toEqual({
      tools: {
        builtin: { enabled: false },
        native: {
          mode: 'none',
          allow: [],
        },
      },
      capabilities: {
        skill: {
          maxChars: 24000,
          explicit: [],
        },
      },
    })
  })

  // ── Default case: other general-purpose origins get browser ─────────

  it('applies lifecycle defaults for schedule origin', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'schedule', scheduleId: 'sched-1' },
    })

    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [
            { capability: 'browser' },
            { capability: 'html' },
            { capability: 'interaction', tool: 'ask_user_question' },
            { capability: 'issues', tool: 'propose_issue_operation' },
            { capability: 'schedules', tool: 'propose_schedule_operation' },
          ],
        },
      },
    })
  })

  it('applies browser and html defaults for generic origins that fall through to default case', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'telegram', botId: 'bot-1', chatId: 'chat-1' },
    })

    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [
            { capability: 'browser' },
            { capability: 'html' },
            { capability: 'interaction', tool: 'ask_user_question' },
            { capability: 'issues', tool: 'propose_issue_operation' },
            { capability: 'schedules', tool: 'propose_schedule_operation' },
          ],
        },
      },
    })
  })

  // ── Creator origins: no native tools ──────────────────────────────

  it('returns undefined for creator origins (no native tools needed)', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'skill-creator' },
    })

    expect(policy).toBeUndefined()
  })

  it('derives explicit skill activation and evose native allowlist from prompt slash blocks', () => {
    const policy = buildSessionPolicyInput({
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

    // issue origin defaults include browser + html; evose is appended from slash command
    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [
            { capability: 'browser' },
            { capability: 'html' },
            { capability: 'interaction', tool: 'ask_user_question' },
            { capability: 'issues', tool: 'propose_issue_operation' },
            { capability: 'schedules', tool: 'propose_schedule_operation' },
            { capability: 'evose' },
          ],
        },
      },
      capabilities: {
        skill: {
          explicit: ['evose:agent_github_iab8p2'],
          implicitQuery: '请调用 evose app',
        },
      },
    })
  })

  it('keeps existing native allowlist entries and appends prompt-derived evose capability once', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'issue', issueId: 'issue-1' },
      policy: {
        tools: {
          native: {
            mode: 'allowlist',
            allow: [{ capability: 'browser' }],
          },
        },
      },
      prompt: [
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
          expandedText: 'x',
        },
        {
          type: 'slash_command',
          name: 'evose:agent_wleg7v',
          category: 'skill',
          label: '品牌设计 Agent',
          execution: {
            nativeRequirements: [{ capability: 'evose' }],
            providerExecution: {
              provider: 'evose',
              appId: 'agent_wleg7v',
              appType: 'agent',
              gatewayTool: 'evose_run_agent',
            },
          },
          expandedText: 'x',
        },
      ],
    })

    // Explicit policy override replaces default native allow (browser only, no html),
    // then evose is appended from prompt-derived slash commands
    expect(policy).toEqual({
      tools: {
        native: {
          mode: 'allowlist',
          allow: [{ capability: 'browser' }, { capability: 'evose' }],
        },
      },
      capabilities: {
        skill: {
          explicit: ['evose:agent_github_iab8p2', 'evose:agent_wleg7v'],
        },
      },
    })
  })
})
