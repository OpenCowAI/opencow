// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { getBaseSystemPrompt } from '../../../electron/command/baseSystemPrompt'

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
})
