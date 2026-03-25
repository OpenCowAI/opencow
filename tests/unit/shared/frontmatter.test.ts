// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseFrontmatter, extractBody, buildFrontmatter } from '@shared/frontmatter'

describe('frontmatter', () => {
  describe('parseFrontmatter', () => {
    it('parses YAML frontmatter from markdown', () => {
      const content = '---\nname: test\ndescription: A test\n---\n# Body'
      const result = parseFrontmatter(content)
      expect(result.attributes).toEqual({ name: 'test', description: 'A test' })
      expect(result.body).toBe('# Body')
    })

    it('handles quoted strings', () => {
      const content = '---\nname: "quoted"\n---'
      expect(parseFrontmatter(content).attributes['name']).toBe('quoted')
    })

    it('returns empty attributes and original content for no frontmatter', () => {
      const result = parseFrontmatter('# Just body')
      expect(result.attributes).toEqual({})
      expect(result.body).toBe('# Just body')
    })

    it('supports nested YAML objects', () => {
      const content = '---\nname: test\nmetadata:\n  key: value\n---\nbody'
      const result = parseFrontmatter(content)
      expect(result.attributes).toEqual({
        name: 'test',
        metadata: { key: 'value' },
      })
      expect(result.body).toBe('body')
    })

    it('handles YAML arrays', () => {
      const content = '---\ntags:\n  - a\n  - b\n---\nbody'
      const result = parseFrontmatter(content)
      expect(result.attributes['tags']).toEqual(['a', 'b'])
    })

    it('gracefully handles malformed YAML', () => {
      // Unclosed brace causes a real YAML parse error
      const content = '---\nkey: {unclosed\n---\nbody'
      const result = parseFrontmatter(content)
      expect(result.attributes).toEqual({})
      expect(result.body).toBe('---\nkey: {unclosed\n---\nbody')
    })
  })

  describe('extractBody', () => {
    it('returns content after frontmatter', () => {
      const content = '---\nname: test\n---\n\n# Body\nMore text'
      expect(extractBody(content)).toBe('# Body\nMore text')
    })

    it('returns entire content when no frontmatter', () => {
      expect(extractBody('# Just body')).toBe('# Just body')
    })
  })

  describe('buildFrontmatter', () => {
    it('builds YAML frontmatter from fields', () => {
      const result = buildFrontmatter({ name: 'test', description: 'A test' })
      expect(result).toBe('---\nname: test\ndescription: A test\n---')
    })

    it('omits empty-string values', () => {
      const result = buildFrontmatter({ name: 'test', model: '' })
      expect(result).toBe('---\nname: test\n---')
    })

    it('omits null and undefined values', () => {
      const result = buildFrontmatter({ name: 'test', foo: null, bar: undefined })
      expect(result).toBe('---\nname: test\n---')
    })

    it('returns empty frontmatter when all values are empty', () => {
      const result = buildFrontmatter({ name: '', model: '' })
      expect(result).toBe('---\n---')
    })

    it('handles nested objects', () => {
      const result = buildFrontmatter({ name: 'test', metadata: { key: 'value' } })
      expect(result).toContain('name: test')
      expect(result).toContain('metadata:')
      expect(result).toContain('key: value')
    })
  })
})
