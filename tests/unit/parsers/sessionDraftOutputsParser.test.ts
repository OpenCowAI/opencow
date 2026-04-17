// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { ManagedSessionMessage } from '../../../src/shared/types'
import { extractLatestIssueOutput } from '../../../src/shared/issueOutputParser'
import { extractLatestScheduleOutput } from '../../../src/shared/scheduleOutputParser'
import { resolveLatestSessionDraftType, resolveLatestSessionDraft } from '../../../src/shared/sessionDraftOutputParser'

function assistantText(text: string): ManagedSessionMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
  }
}

function userText(text: string): ManagedSessionMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
  }
}

describe('session draft output parsers', () => {
  it('extractLatestIssueOutput picks latest valid issue-output from assistant messages', () => {
    const messages: ManagedSessionMessage[] = [
      userText('please create issue'),
      assistantText([
        '```issue-output',
        '---',
        'title: "Old title"',
        'status: todo',
        'priority: medium',
        'labels: ["bug"]',
        '---',
        'old description',
        '```',
      ].join('\n')),
      assistantText([
        '```issue-output',
        '---',
        'title: "New title"',
        'status: in_progress',
        'priority: high',
        'labels: ["bug", "backend"]',
        '---',
        'new description',
        '```',
      ].join('\n')),
    ]

    const parsed = extractLatestIssueOutput(messages)
    expect(parsed).not.toBeNull()
    expect(parsed?.title).toBe('New title')
    expect(parsed?.status).toBe('in_progress')
    expect(parsed?.priority).toBe('high')
    expect(parsed?.labels).toEqual(['bug', 'backend'])
    expect(parsed?.description).toBe('new description')
  })

  it('extractLatestScheduleOutput picks latest valid schedule-output from assistant messages', () => {
    const messages: ManagedSessionMessage[] = [
      assistantText([
        '```schedule-output',
        '---',
        'name: "Daily old"',
        'description: "old"',
        'frequency: daily',
        'timeOfDay: "09:00"',
        'priority: normal',
        '---',
        'old prompt',
        '```',
      ].join('\n')),
      userText('change it to weekly'),
      assistantText([
        '```schedule-output',
        '---',
        'name: "Weekly new"',
        'description: "new"',
        'frequency: weekly',
        'timeOfDay: "10:30"',
        'daysOfWeek: [1, 3, 5]',
        'priority: high',
        '---',
        'new prompt body',
        '```',
      ].join('\n')),
    ]

    const parsed = extractLatestScheduleOutput(messages)
    expect(parsed).not.toBeNull()
    expect(parsed?.name).toBe('Weekly new')
    expect(parsed?.frequency).toBe('weekly')
    expect(parsed?.timeOfDay).toBe('10:30')
    expect(parsed?.daysOfWeek).toEqual([1, 3, 5])
    expect(parsed?.priority).toBe('high')
    expect(parsed?.prompt).toBe('new prompt body')
  })

  it('extractLatestScheduleOutput parses optional systemPrompt from frontmatter', () => {
    const messages: ManagedSessionMessage[] = [
      assistantText([
        '```schedule-output',
        '---',
        'name: "Daily system prompt test"',
        'frequency: daily',
        'timeOfDay: "09:00"',
        'priority: normal',
        'systemPrompt: "Always output concise bullet points."',
        '---',
        'do the thing',
        '```',
      ].join('\n')),
    ]

    const parsed = extractLatestScheduleOutput(messages)
    expect(parsed?.systemPrompt).toBe('Always output concise bullet points.')
  })

  it('resolveLatestSessionDraftType picks the latest valid draft across issue/schedule types', () => {
    const messages: ManagedSessionMessage[] = [
      assistantText([
        '```issue-output',
        '---',
        'title: "Issue first"',
        'status: todo',
        'priority: medium',
        'labels: ["bug"]',
        '---',
        'issue body',
        '```',
      ].join('\n')),
      assistantText([
        '```schedule-output',
        '---',
        'name: "Schedule later"',
        'frequency: daily',
        'timeOfDay: "09:00"',
        'priority: normal',
        '---',
        'schedule prompt',
        '```',
      ].join('\n')),
    ]

    expect(resolveLatestSessionDraftType(messages)).toBe('schedule')
  })

  it('resolveLatestSessionDraftType handles mixed fences in one message by last fence order', () => {
    const mixed = assistantText([
      '```schedule-output',
      '---',
      'name: "Earlier schedule"',
      'frequency: daily',
      'timeOfDay: "09:00"',
      'priority: normal',
      '---',
      'schedule prompt',
      '```',
      '',
      '```issue-output',
      '---',
      'title: "Later issue"',
      'status: todo',
      'priority: medium',
      'labels: []',
      '---',
      'issue body',
      '```',
    ].join('\n'))

    expect(resolveLatestSessionDraftType([mixed])).toBe('issue')
  })

  it('resolveLatestSessionDraft returns active draft with stable key', () => {
    const messages: ManagedSessionMessage[] = [
      assistantText([
        '```schedule-output',
        '---',
        'name: "Weekly report"',
        'frequency: weekly',
        'timeOfDay: "10:30"',
        'daysOfWeek: [1, 3, 5]',
        'priority: high',
        '---',
        'send weekly report',
        '```',
      ].join('\n')),
    ]

    const resolved = resolveLatestSessionDraft(messages)
    expect(resolved).not.toBeNull()
    expect(resolved?.type).toBe('schedule')
    expect(resolved?.draft.name).toBe('Weekly report')
    expect(resolved?.key).toBeTruthy()
    expect(typeof resolved?.key).toBe('string')
  })

  it('resolveLatestSessionDraft key changes when schedule systemPrompt changes', () => {
    const withSystemPrompt = assistantText([
      '```schedule-output',
      '---',
      'name: "Weekly report"',
      'frequency: weekly',
      'timeOfDay: "10:30"',
      'daysOfWeek: [1, 3, 5]',
      'priority: high',
      'systemPrompt: "Be concise"',
      '---',
      'send weekly report',
      '```',
    ].join('\n'))
    const withoutSystemPrompt = assistantText([
      '```schedule-output',
      '---',
      'name: "Weekly report"',
      'frequency: weekly',
      'timeOfDay: "10:30"',
      'daysOfWeek: [1, 3, 5]',
      'priority: high',
      '---',
      'send weekly report',
      '```',
    ].join('\n'))

    const keyA = resolveLatestSessionDraft([withSystemPrompt])?.key
    const keyB = resolveLatestSessionDraft([withoutSystemPrompt])?.key
    expect(keyA).toBeTruthy()
    expect(keyB).toBeTruthy()
    expect(keyA).not.toBe(keyB)
  })
})
