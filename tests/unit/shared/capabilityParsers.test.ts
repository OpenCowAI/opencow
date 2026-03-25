// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import {
  parseSourceForForm,
  resolveConfigSection,
  extractSourceSection
} from '@shared/capabilityParsers'

// === resolveConfigSection ===

describe('resolveConfigSection', () => {
  it('returns undefined for file-per-capability categories', () => {
    expect(resolveConfigSection('{}', 'command', 'test')).toBeUndefined()
    expect(resolveConfigSection('{}', 'skill', 'test')).toBeUndefined()
    expect(resolveConfigSection('{}', 'agent', 'test')).toBeUndefined()
    expect(resolveConfigSection('{}', 'rule', 'test')).toBeUndefined()
  })

  describe('hook', () => {
    it('resolves from nested settings.json structure (hooks.eventName)', () => {
      const content = JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'lint.sh' }] }],
          PostToolUse: [{ hooks: [{ type: 'command', command: 'test.sh' }] }]
        },
        permissions: { allow: [] }
      })
      const result = resolveConfigSection(content, 'hook', 'PreToolUse')
      expect(result).toEqual([{ hooks: [{ type: 'command', command: 'lint.sh' }] }])
    })

    it('falls back to top-level key when hooks wrapper is absent', () => {
      const content = JSON.stringify({
        SessionStart: [{ hooks: [{ type: 'command', command: 'start.sh' }] }]
      })
      const result = resolveConfigSection(content, 'hook', 'SessionStart')
      expect(result).toEqual([{ hooks: [{ type: 'command', command: 'start.sh' }] }])
    })

    it('returns undefined for non-existent event', () => {
      const content = JSON.stringify({ hooks: { PreToolUse: [] } })
      expect(resolveConfigSection(content, 'hook', 'NonExistent')).toBeUndefined()
    })

    it('returns undefined for malformed JSON', () => {
      expect(resolveConfigSection('not json', 'hook', 'test')).toBeUndefined()
    })
  })

  describe('mcp-server', () => {
    it('resolves from nested .claude.json structure (mcpServers.name)', () => {
      const content = JSON.stringify({
        mcpServers: {
          'my-server': { type: 'stdio', command: 'npx', args: ['-y', 'srv'] }
        },
        projects: {}
      })
      const result = resolveConfigSection(content, 'mcp-server', 'my-server')
      expect(result).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'srv'] })
    })

    it('resolves from flat .mcp.json structure (top-level key)', () => {
      const content = JSON.stringify({
        'my-server': { type: 'stdio', command: 'npx' }
      })
      const result = resolveConfigSection(content, 'mcp-server', 'my-server')
      expect(result).toEqual({ type: 'stdio', command: 'npx' })
    })

    it('prefers mcpServers wrapper over top-level key', () => {
      const content = JSON.stringify({
        mcpServers: { srv: { type: 'sse' } },
        srv: { type: 'stdio' }  // should be ignored
      })
      expect(resolveConfigSection(content, 'mcp-server', 'srv'))
        .toEqual({ type: 'sse' })
    })

    it('returns undefined for non-existent server', () => {
      const content = JSON.stringify({ mcpServers: { other: {} } })
      expect(resolveConfigSection(content, 'mcp-server', 'missing')).toBeUndefined()
    })
  })
})

// === extractSourceSection ===

describe('extractSourceSection', () => {
  it('returns full content for file-per-capability categories', () => {
    const markdown = '---\ndescription: test\n---\n# body'
    expect(extractSourceSection('command', markdown, 'test')).toBe(markdown)
    expect(extractSourceSection('skill', markdown, 'test')).toBe(markdown)
    expect(extractSourceSection('agent', markdown, 'test')).toBe(markdown)
    expect(extractSourceSection('rule', markdown, 'test')).toBe(markdown)
  })

  it('extracts hook section with structural context', () => {
    const content = JSON.stringify({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'lint.sh' }] }],
        PostToolUse: []
      },
      permissions: {}
    })
    const result = extractSourceSection('hook', content, 'PreToolUse')
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'lint.sh' }] }]
      }
    })
    // PostToolUse and permissions should NOT be present
    expect(parsed.hooks.PostToolUse).toBeUndefined()
    expect(parsed.permissions).toBeUndefined()
  })

  it('extracts MCP server section', () => {
    const content = JSON.stringify({
      mcpServers: {
        'my-srv': { type: 'stdio', command: 'npx' },
        'other-srv': { type: 'sse' }
      }
    })
    const result = extractSourceSection('mcp-server', content, 'my-srv')
    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ 'my-srv': { type: 'stdio', command: 'npx' } })
    expect(parsed['other-srv']).toBeUndefined()
  })

  it('returns full content when section not found', () => {
    const content = JSON.stringify({ hooks: {} })
    expect(extractSourceSection('hook', content, 'NonExistent')).toBe(content)
  })

  it('returns full content on malformed JSON', () => {
    const bad = 'not json'
    expect(extractSourceSection('hook', bad, 'test')).toBe(bad)
  })
})

// === parseSourceForForm ===

describe('parseSourceForForm', () => {
  it('parses command markdown to form fields', () => {
    const source = '---\ndescription: Deploy\nargument-hint: <env>\n---\n\n# Deploy body'
    const result = parseSourceForForm('command', source, 'deploy')
    expect(result).toEqual({
      name: 'deploy',
      description: 'Deploy',
      argumentHint: '<env>',
      body: '# Deploy body'
    })
  })

  it('parses agent markdown to form fields', () => {
    // Note: YAML requires quoting hex colors — unquoted #f00 is treated as a comment
    const source = '---\nname: reviewer\ndescription: Reviews\nmodel: sonnet\ncolor: "#f00"\n---\n\n# Agent body'
    const result = parseSourceForForm('agent', source, 'reviewer')
    expect(result).toEqual({
      name: 'reviewer',
      description: 'Reviews',
      model: 'sonnet',
      color: '#f00',
      body: '# Agent body'
    })
  })

  it('parses skill SKILL.md', () => {
    const source = '---\nname: test\ndescription: A skill\n---\nBody'
    const result = parseSourceForForm('skill', source, 'test')
    expect(result.name).toBe('test')
    expect(result.description).toBe('A skill')
    expect(result.body).toBe(source)
  })

  describe('hook', () => {
    it('parses from flat JSON (top-level event key)', () => {
      const source = JSON.stringify({
        SessionStart: [
          { __opencow__: true, hooks: [{ type: 'command', command: 'opencow-hook.sh' }] },
          { hooks: [{ type: 'command', command: 'user.sh' }] }
        ]
      })
      const result = parseSourceForForm('hook', source, 'SessionStart')
      expect(result.eventName).toBe('SessionStart')
      expect(result.rules).toEqual([{ type: 'command', command: 'user.sh' }])
    })

    it('parses from nested settings.json (hooks.eventName)', () => {
      const source = JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: 'lint.sh' }] },
            { __opencow__: true, hooks: [{ type: 'command', command: 'auto.sh' }] }
          ]
        },
        permissions: { allow: [] }
      })
      const result = parseSourceForForm('hook', source, 'PreToolUse')
      expect(result.eventName).toBe('PreToolUse')
      expect(result.rules).toEqual([{ type: 'command', command: 'lint.sh' }])
    })

    it('returns empty rules for non-existent event', () => {
      const source = JSON.stringify({ hooks: { Other: [] } })
      const result = parseSourceForForm('hook', source, 'Missing')
      expect(result.rules).toEqual([])
    })
  })

  describe('mcp-server', () => {
    it('parses from flat .mcp.json (top-level server key)', () => {
      const source = JSON.stringify({
        srv: { type: 'stdio', command: 'npx', args: ['-y', 'srv'] }
      })
      const result = parseSourceForForm('mcp-server', source, 'srv')
      expect(result.name).toBe('srv')
      expect(result.type).toBe('stdio')
      expect(result.args).toEqual(['-y', 'srv'])
    })

    it('parses from nested .claude.json (mcpServers.name)', () => {
      const source = JSON.stringify({
        mcpServers: {
          'my-srv': { type: 'sse', command: 'node', args: ['server.js'], env: { PORT: '3000' } }
        },
        projects: {}
      })
      const result = parseSourceForForm('mcp-server', source, 'my-srv')
      expect(result.name).toBe('my-srv')
      expect(result.type).toBe('sse')
      expect(result.command).toBe('node')
      expect(result.args).toEqual(['server.js'])
      expect(result.env).toEqual({ PORT: '3000' })
    })

    it('returns defaults for non-existent server', () => {
      const source = JSON.stringify({ mcpServers: {} })
      const result = parseSourceForForm('mcp-server', source, 'missing')
      expect(result.type).toBe('stdio')
      expect(result.command).toBe('')
    })
  })
})
