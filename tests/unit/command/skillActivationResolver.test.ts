// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  resolveActivatedSkillNames,
  resolveImplicitSkillActivationQuery,
} from '../../../electron/command/skillActivationResolver'

describe('resolveActivatedSkillNames', () => {
  it('returns empty for plain string content', () => {
    expect(resolveActivatedSkillNames('hello')).toEqual([])
  })

  it('extracts and de-duplicates slash skill blocks', () => {
    const result = resolveActivatedSkillNames([
      { type: 'text', text: 'intro' },
      {
        type: 'slash_command',
        name: 'docs-sync',
        category: 'skill',
        label: 'docs-sync',
        expandedText: 'sync docs',
      },
      {
        type: 'slash_command',
        name: '/docs-sync',
        category: 'skill',
        label: '/docs-sync',
        expandedText: 'sync docs again',
      },
      {
        type: 'slash_command',
        name: 'build',
        category: 'command',
        label: 'build',
        expandedText: 'run build',
      },
    ])

    expect(result).toEqual(['docs-sync'])
  })
})

describe('resolveImplicitSkillActivationQuery', () => {
  it('normalizes plain string content', () => {
    expect(resolveImplicitSkillActivationQuery('  sync   docs \n before output  ')).toBe('sync docs before output')
  })

  it('extracts text blocks only and ignores slash/image/document blocks', () => {
    const query = resolveImplicitSkillActivationQuery([
      { type: 'text', text: 'please sync docs' },
      {
        type: 'slash_command',
        name: 'docs-sync',
        category: 'skill',
        label: 'docs-sync',
        expandedText: 'expanded skill text',
      },
      { type: 'image', mediaType: 'image/png', data: 'abc', sizeBytes: 12 },
      { type: 'document', mediaType: 'text/plain', data: 'file-body', sizeBytes: 20, title: 'notes.txt' },
      { type: 'text', text: 'and verify links' },
    ])

    expect(query).toBe('please sync docs and verify links')
  })

  it('returns undefined when no text is present', () => {
    const query = resolveImplicitSkillActivationQuery([
      {
        type: 'slash_command',
        name: 'docs-sync',
        category: 'skill',
        label: 'docs-sync',
        expandedText: 'expanded skill text',
      },
    ])
    expect(query).toBeUndefined()
  })
})
