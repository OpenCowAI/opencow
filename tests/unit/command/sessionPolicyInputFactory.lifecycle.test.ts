// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSessionPolicyInput } from '../../../electron/command/policy/sessionPolicyInputFactory'

describe('buildSessionPolicyInput lifecycle propose defaults', () => {
  it('injects issue/schedule propose tools for issue origin', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'issue', issueId: 'issue-1' },
    })

    expect(policy?.tools?.native?.mode).toBe('allowlist')
    expect(policy?.tools?.native?.allow).toEqual([
      { capability: 'browser' },
      { capability: 'html' },
      { capability: 'interaction', tool: 'ask_user_question' },
      { capability: 'issues', tool: 'propose_issue_operation' },
      { capability: 'schedules', tool: 'propose_schedule_operation' },
    ])
  })

  it('injects issue/schedule propose tools for schedule origin', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'schedule', scheduleId: 'sched-1' },
    })

    expect(policy?.tools?.native?.mode).toBe('allowlist')
    expect(policy?.tools?.native?.allow).toEqual([
      { capability: 'browser' },
      { capability: 'html' },
      { capability: 'interaction', tool: 'ask_user_question' },
      { capability: 'issues', tool: 'propose_issue_operation' },
      { capability: 'schedules', tool: 'propose_schedule_operation' },
    ])
  })

  it('injects issue/schedule propose tools for creator origins', () => {
    const issueCreator = buildSessionPolicyInput({
      origin: { source: 'issue-creator' },
    })
    const scheduleCreator = buildSessionPolicyInput({
      origin: { source: 'schedule-creator' },
    })

    const expectedAllow = [
      { capability: 'browser' },
      { capability: 'html' },
      { capability: 'interaction', tool: 'ask_user_question' },
      { capability: 'issues', tool: 'propose_issue_operation' },
      { capability: 'schedules', tool: 'propose_schedule_operation' },
    ]

    expect(issueCreator?.tools?.native?.allow).toEqual(expectedAllow)
    expect(scheduleCreator?.tools?.native?.allow).toEqual(expectedAllow)
  })
})
