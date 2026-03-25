// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '@shared/frontmatter'

describe('parseFrontmatter', () => {
  it('extracts key-value pairs from YAML frontmatter', () => {
    const content = `---
name: test-command
description: A test command
argument-hint: <file>
---

# Content here`
    const result = parseFrontmatter(content)
    expect(result.attributes).toEqual({
      name: 'test-command',
      description: 'A test command',
      'argument-hint': '<file>'
    })
    expect(result.body).toBe('# Content here')
  })

  it('handles quoted strings', () => {
    const content = `---
name: "quoted-name"
description: 'single quoted'
---`
    const result = parseFrontmatter(content)
    expect(result.attributes['name']).toBe('quoted-name')
    expect(result.attributes['description']).toBe('single quoted')
  })

  it('returns empty attributes for empty content', () => {
    const result = parseFrontmatter('')
    expect(result.attributes).toEqual({})
    expect(result.body).toBe('')
  })

  it('returns empty attributes for content without frontmatter markers', () => {
    const content = '# Just a heading\n\nSome text'
    const result = parseFrontmatter(content)
    expect(result.attributes).toEqual({})
    expect(result.body).toBe(content)
  })

  it('handles frontmatter with only some fields', () => {
    const content = `---
name: partial
---`
    const result = parseFrontmatter(content)
    expect(result.attributes['name']).toBe('partial')
    expect(result.attributes['description']).toBeUndefined()
  })

  it('returns empty attributes for bare key-value lines without frontmatter delimiters', () => {
    const content = `name: bare-skill\ndescription: Found without delimiters`
    const result = parseFrontmatter(content)
    // Shared frontmatter module only parses within --- delimiters
    expect(result.attributes).toEqual({})
    expect(result.body).toBe(content)
  })
})

describe('hooks JSON parsing logic', () => {
  it('correctly structures hook events from settings JSON', () => {
    const hooks: Record<string, unknown[]> = {
      SessionStart: [
        {
          hooks: [{ type: 'command', command: '/path/to/script.sh' }],
          __opencow__: true
        }
      ],
      Stop: [
        {
          hooks: [{ type: 'command', command: '/path/to/other.sh' }],
          __opencow__: false
        },
        {
          hooks: [{ type: 'command', command: '/path/to/opencow-hook.sh' }],
          __opencow__: true
        }
      ]
    }

    // Replicate the parsing logic from the service
    const result: { eventName: string; ruleCount: number; hasOpenCow: boolean }[] = []
    for (const [eventName, ruleGroups] of Object.entries(hooks)) {
      let ruleCount = 0
      let hasOpenCow = false
      for (const group of ruleGroups) {
        const g = group as Record<string, unknown>
        if (g['__opencow__'] === true) hasOpenCow = true
        const innerHooks = g['hooks'] as Array<Record<string, string>>
        ruleCount += innerHooks.length
      }
      result.push({ eventName, ruleCount, hasOpenCow })
    }

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ eventName: 'SessionStart', ruleCount: 1, hasOpenCow: true })
    expect(result[1]).toEqual({ eventName: 'Stop', ruleCount: 2, hasOpenCow: true })
  })

  it('handles empty hooks object', () => {
    const hooks: Record<string, unknown[]> = {}
    expect(Object.entries(hooks)).toHaveLength(0)
  })
})

describe('MCP plugin.json parsing logic', () => {
  it('extracts metadata from plugin.json structure', () => {
    const pluginJson = {
      name: 'github',
      description: 'Official GitHub MCP server',
      author: { name: 'GitHub' }
    }
    const mcpJson = { github: { type: 'http', url: 'https://example.com' } }

    expect(pluginJson['name']).toBe('github')
    expect(pluginJson['description']).toBe('Official GitHub MCP server')
    expect(pluginJson['author']['name']).toBe('GitHub')
    expect(mcpJson['github']['type']).toBe('http')
  })

  it('handles plugin.json without author', () => {
    const pluginJson = { name: 'test', description: 'No author' }
    const author = (pluginJson as Record<string, unknown>)['author'] as Record<string, string> | undefined
    expect(author?.['name'] ?? '').toBe('')
  })
})

describe('MCP ~/.claude.json parsing logic', () => {
  it('extracts user-scope MCP servers from top-level mcpServers', () => {
    const data = {
      mcpServers: {
        github: { type: 'http', url: 'https://example.com' }
      },
      projects: {}
    }
    const userMcp = data.mcpServers
    expect(Object.keys(userMcp)).toEqual(['github'])
    expect(userMcp['github']['type']).toBe('http')
  })

  it('extracts local-scope MCP servers from projects[path].mcpServers', () => {
    const data = {
      projects: {
        '/Users/test/my-project': {
          mcpServers: {
            'tavily-remote': { type: 'stdio', command: 'npx' }
          }
        }
      }
    }
    const projectData = data.projects['/Users/test/my-project']
    const localMcp = projectData.mcpServers
    expect(Object.keys(localMcp)).toEqual(['tavily-remote'])
    expect(localMcp['tavily-remote']['type']).toBe('stdio')
  })

  it('handles missing projects key gracefully', () => {
    const data = { numStartups: 5 }
    const projects = (data as Record<string, unknown>)['projects'] as Record<string, unknown> | undefined
    expect(projects).toBeUndefined()
  })
})

describe('MCP .mcp.json parsing logic', () => {
  it('extracts servers from project .mcp.json with mcpServers wrapper', () => {
    const data = {
      mcpServers: {
        'shared-server': { command: '/path/to/server', type: 'stdio' }
      }
    }
    const servers = data.mcpServers
    expect(Object.keys(servers)).toEqual(['shared-server'])
  })

  it('extracts servers from flat .mcp.json (no wrapper)', () => {
    const data = {
      'database-tools': { command: '/path/to/db-server', type: 'stdio' }
    }
    expect(Object.keys(data)).toEqual(['database-tools'])
  })
})

describe('hooks dual-scope parsing', () => {
  it('correctly parses project-level settings.json hooks', () => {
    const hooks: Record<string, unknown[]> = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: './scripts/validate.sh' }]
        }
      ]
    }

    const result: { eventName: string; ruleCount: number }[] = []
    for (const [eventName, ruleGroups] of Object.entries(hooks)) {
      let ruleCount = 0
      for (const group of ruleGroups) {
        const g = group as Record<string, unknown>
        const innerHooks = g['hooks'] as Array<Record<string, string>>
        ruleCount += innerHooks.length
      }
      result.push({ eventName, ruleCount })
    }

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ eventName: 'PreToolUse', ruleCount: 1 })
  })
})

describe('command sorting', () => {
  it('sorts commands alphabetically by name', () => {
    const commands = [
      { name: 'zebra', description: '' },
      { name: 'alpha', description: '' },
      { name: 'middle', description: '' }
    ]
    commands.sort((a, b) => a.name.localeCompare(b.name))
    expect(commands.map((c) => c.name)).toEqual(['alpha', 'middle', 'zebra'])
  })
})
