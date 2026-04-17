// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { getBaseSystemPrompt } from '../../../electron/command/baseSystemPrompt'
import { buildSessionPolicyInput } from '../../../electron/command/policy/sessionPolicyInputFactory'

describe('getBaseSystemPrompt', () => {
  it('returns the base prompt for standard session origins', () => {
    for (const origin of ['agent', 'issue', 'telegram', 'schedule', 'hook']) {
      const result = getBaseSystemPrompt(origin)
      expect(result).toBeDefined()
      expect(result).toContain('<task-approach>')
      expect(result).toContain('</task-approach>')
    }
  })

  it('returns undefined for browser-agent (has its own prompt)', () => {
    expect(getBaseSystemPrompt('browser-agent')).toBeUndefined()
  })

  it('returns undefined for review (has its own prompt)', () => {
    expect(getBaseSystemPrompt('review')).toBeUndefined()
  })

  it('includes the three assessment dimensions', () => {
    const prompt = getBaseSystemPrompt('agent')!
    expect(prompt).toContain('Impact scope')
    expect(prompt).toContain('Certainty')
    expect(prompt).toContain('Reversibility')
  })

  it('includes the three response strategies', () => {
    const prompt = getBaseSystemPrompt('agent')!
    expect(prompt).toContain('**Act**')
    expect(prompt).toContain('**Plan → Act**')
    expect(prompt).toContain('**Propose → Confirm → Act**')
  })

  it('prefers embedded browser tools for URL open requests', () => {
    const prompt = getBaseSystemPrompt('agent')!
    expect(prompt).toContain('<browser-tool-preference>')
    expect(prompt).toContain('Prefer the MCP browser tools first')
    expect(prompt).toContain('Do NOT run shell launch commands')
    expect(prompt).toContain('open')
    expect(prompt).toContain('start')
    expect(prompt).toContain('xdg-open')
  })

  it('includes decoupled entity governance rules for issue and schedule', () => {
    const prompt = getBaseSystemPrompt('agent')!
    expect(prompt).toContain('<entity-governance>')
    expect(prompt).toContain('<rule name="entity-router">')
    expect(prompt).toContain('<rule name="issue-governance">')
    expect(prompt).toContain('<rule name="schedule-governance">')
    expect(prompt).toContain('For any scheduled-plan intent (daily/weekly/monthly/cron/time-based execution), prioritize schedule native capability tools.')
    expect(prompt).toContain('Do not use OS-level schedulers (cron/launchd/systemd) unless the user explicitly asks for OS-level scheduling.')
    expect(prompt).toContain('Do not run MCP capability-discovery calls (resources/resourceTemplates) before schedule execution unless the user explicitly asks you to inspect templates.')
  })

  it('keeps prompt/tool contract aligned for ask_user_question in default desktop sessions', () => {
    const prompt = getBaseSystemPrompt('agent')!
    expect(prompt).toContain('use the `ask_user_question` tool instead of writing options as plain text.')

    const policy = buildSessionPolicyInput({ origin: { source: 'agent' } })
    expect(policy?.tools?.native?.allow).toEqual(
      expect.arrayContaining([{ capability: 'interaction' }]),
    )
  })
})
