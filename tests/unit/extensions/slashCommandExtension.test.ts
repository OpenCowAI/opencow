// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { SlashCommandExtension } from '../../../src/renderer/extensions/slashCommandExtension'

describe('SlashCommandExtension', () => {
  it('creates an extension with name "slashCommand"', () => {
    const ext = SlashCommandExtension.configure({
      suggestion: {
        char: '/',
        items: () => [],
      },
    })
    expect(ext.name).toBe('slashCommand')
  })

  it('defaults suggestion char to "/"', () => {
    const ext = SlashCommandExtension.configure({})
    expect(ext.options.suggestion.char).toBe('/')
  })

  it('defaults startOfLine to false (any position)', () => {
    const ext = SlashCommandExtension.configure({})
    expect(ext.options.suggestion.startOfLine).toBe(false)
  })

  it('defaults allowSpaces to false', () => {
    const ext = SlashCommandExtension.configure({})
    expect(ext.options.suggestion.allowSpaces).toBe(false)
  })

  it('allows overriding suggestion options', () => {
    const ext = SlashCommandExtension.configure({
      suggestion: {
        char: '#',
        startOfLine: true,
      },
    })
    expect(ext.options.suggestion.char).toBe('#')
    expect(ext.options.suggestion.startOfLine).toBe(true)
  })
})
