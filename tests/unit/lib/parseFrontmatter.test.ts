// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '@/lib/parseFrontmatter'

describe('parseFrontmatter', () => {
  it('returns the input untouched when no frontmatter is present', () => {
    const content = '# Heading\n\nbody'
    expect(parseFrontmatter(content)).toEqual({
      frontmatter: null,
      body: content,
    })
  })

  it('parses a simple flat frontmatter map', () => {
    const content = '---\nname: alpha\ntag: skill\n---\n# Title'
    expect(parseFrontmatter(content)).toEqual({
      frontmatter: { name: 'alpha', tag: 'skill' },
      body: '# Title',
    })
  })

  it('parses YAML block scalars (the `|` pipe operator)', () => {
    const content = [
      '---',
      'name: evose-prototype-impl',
      'description: |',
      '  line one',
      '  line two',
      '---',
      'body text',
    ].join('\n')
    const result = parseFrontmatter(content)
    expect(result.frontmatter).toEqual({
      name: 'evose-prototype-impl',
      // YAML's `|` preserves newlines and adds a trailing one
      description: 'line one\nline two\n',
    })
    expect(result.body).toBe('body text')
  })

  it('handles CRLF line endings', () => {
    const content = '---\r\nkey: value\r\n---\r\nbody'
    expect(parseFrontmatter(content)).toEqual({
      frontmatter: { key: 'value' },
      body: 'body',
    })
  })

  it('preserves the raw content when YAML is malformed', () => {
    // An unclosed flow-sequence is a hard YAML parse error.
    const content = '---\nkey: [unclosed\n---\nbody'
    const result = parseFrontmatter(content)
    expect(result.frontmatter).toBeNull()
    expect(result.body).toBe(content)
  })

  it('treats non-map YAML (e.g. a top-level scalar) as no frontmatter', () => {
    // `42` parses to a number, not a Record — there are no key/value
    // pairs to surface, so we fall back to the original content.
    const content = '---\n42\n---\nbody'
    expect(parseFrontmatter(content)).toEqual({
      frontmatter: null,
      body: content,
    })
  })

  it('does not treat a horizontal rule as a frontmatter delimiter', () => {
    const content = '# Heading\n\n---\nstill body'
    expect(parseFrontmatter(content)).toEqual({
      frontmatter: null,
      body: content,
    })
  })

  it('parses nested objects and arrays', () => {
    const content = [
      '---',
      'name: thing',
      'tags:',
      '  - a',
      '  - b',
      'permissions:',
      '  read: true',
      '---',
      'body',
    ].join('\n')
    expect(parseFrontmatter(content)).toEqual({
      frontmatter: {
        name: 'thing',
        tags: ['a', 'b'],
        permissions: { read: true },
      },
      body: 'body',
    })
  })
})
