// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { buildSessionPolicyInput } from '../../../electron/command/policy/sessionPolicyInputFactory'

const GENERAL_PURPOSE_ALLOW = [
  { capability: 'browser' },
  { capability: 'html' },
  { capability: 'interaction' },
  { capability: 'issues' },
  { capability: 'projects' },
  { capability: 'schedules' },
  { capability: 'evose' },
  { capability: 'lifecycle' },
] as const

describe('buildSessionPolicyInput lifecycle propose defaults', () => {
  it('injects general-purpose native capabilities for issue origin', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'issue', issueId: 'issue-1' },
    })

    expect(policy?.tools?.native?.mode).toBe('allowlist')
    expect(policy?.tools?.native?.allow).toEqual([...GENERAL_PURPOSE_ALLOW])
  })

  it('injects general-purpose native capabilities for schedule origin', () => {
    const policy = buildSessionPolicyInput({
      origin: { source: 'schedule', scheduleId: 'sched-1' },
    })

    expect(policy?.tools?.native?.mode).toBe('allowlist')
    expect(policy?.tools?.native?.allow).toEqual([...GENERAL_PURPOSE_ALLOW])
  })

  it('injects general-purpose native capabilities for creator origins', () => {
    const issueCreator = buildSessionPolicyInput({
      origin: { source: 'issue-creator' },
    })
    const scheduleCreator = buildSessionPolicyInput({
      origin: { source: 'schedule-creator' },
    })

    expect(issueCreator?.tools?.native?.allow).toEqual([...GENERAL_PURPOSE_ALLOW])
    expect(scheduleCreator?.tools?.native?.allow).toEqual([...GENERAL_PURPOSE_ALLOW])
  })
})
