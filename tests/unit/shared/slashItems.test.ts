// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  BUILTIN_SLASH_COMMANDS,
  getBuiltinSlashCommands,
  filterSlashItems,
  groupSlashItems,
} from '../../../src/shared/slashItems'
import type { SlashItem } from '../../../src/shared/slashItems'

describe('BUILTIN_SLASH_COMMANDS', () => {
  it('contains expected core commands', () => {
    const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name)
    expect(names).toContain('compact')
    expect(names).toContain('help')
    expect(names).toContain('status')
    expect(names).toContain('cost')
    expect(names).toContain('usage')
    expect(names).toContain('plan')
    expect(names).not.toContain('clear')
    expect(names).not.toContain('model')
    expect(names).not.toContain('vim')
  })

  it('all items have category "builtin"', () => {
    for (const cmd of BUILTIN_SLASH_COMMANDS) {
      expect(cmd.category).toBe('builtin')
    }
  })

  it('all items have unique ids', () => {
    const ids = BUILTIN_SLASH_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns Claude builtin set when engine is claude', () => {
    const claudeBuiltins = getBuiltinSlashCommands('claude')
    expect(claudeBuiltins).toEqual(BUILTIN_SLASH_COMMANDS)
    expect(claudeBuiltins.some((item) => item.name === 'vim')).toBe(false)
  })

  it('returns codex-safe builtin commands when engine is codex', () => {
    const codexBuiltins = getBuiltinSlashCommands('codex')
    expect(codexBuiltins.map((item) => item.name)).toEqual(['compact', 'status', 'plan'])
  })
})

describe('filterSlashItems', () => {
  const items: SlashItem[] = [
    { id: 'builtin:clear', name: 'clear', description: 'Clear history', category: 'builtin', order: 1 },
    { id: 'builtin:compact', name: 'compact', description: 'Compress context', category: 'builtin', order: 2 },
    { id: 'command:commit', name: 'commit', description: 'Smart commit', category: 'command', order: 1 },
    { id: 'skill:review', name: 'review', description: 'Code review', category: 'skill', order: 1 },
    {
      id: 'skill:global:evose_silicon_brand',
      name: 'evose:silicon_brand_abc123',
      description: 'Brand strategy consultant',
      category: 'skill',
      order: 2,
      presentation: {
        variant: 'app',
        title: '硅谷品牌战略师',
        subtitle: '品牌定位与增长策略',
      },
      executionMeta: {
        provider: 'evose',
        app: {
          id: 'app-brand-001',
          type: 'agent',
          gatewayTool: 'evose_run_agent',
        },
      },
    },
  ]

  it('returns all items when query is empty', () => {
    expect(filterSlashItems(items, '')).toHaveLength(5)
  })

  it('filters by name prefix', () => {
    const result = filterSlashItems(items, 'cl')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('clear')
  })

  it('filters by name substring', () => {
    const result = filterSlashItems(items, 'omm')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('commit')
  })

  it('filters by description', () => {
    const result = filterSlashItems(items, 'context')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('compact')
  })

  it('is case insensitive', () => {
    const result = filterSlashItems(items, 'CLEAR')
    expect(result).toHaveLength(1)
  })

  it('returns empty array when no match', () => {
    expect(filterSlashItems(items, 'xyz')).toHaveLength(0)
  })

  it('matches app items by presentation title', () => {
    const result = filterSlashItems(items, '硅谷品牌')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('skill:global:evose_silicon_brand')
  })

  it('matches app items by app id from execution metadata', () => {
    const result = filterSlashItems(items, 'app-brand-001')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('skill:global:evose_silicon_brand')
  })
})

describe('groupSlashItems', () => {
  const items: SlashItem[] = [
    { id: 'builtin:clear', name: 'clear', description: 'Clear', category: 'builtin', order: 1 },
    { id: 'command:project:commit', name: 'commit', description: 'Commit', category: 'command', order: 1, scope: 'project' },
    { id: 'skill:global:review', name: 'review', description: 'Review', category: 'skill', order: 1, scope: 'global' },
  ]

  it('groups items by category', () => {
    const groups = groupSlashItems(items)
    expect(groups).toHaveLength(3)
    expect(groups[0].category).toBe('builtin')
    expect(groups[1].category).toBe('command')
    expect(groups[2].category).toBe('skill')
  })

  it('omits empty groups', () => {
    const onlyBuiltin = items.filter((i) => i.category === 'builtin')
    const groups = groupSlashItems(onlyBuiltin)
    expect(groups).toHaveLength(1)
    expect(groups[0].category).toBe('builtin')
  })

  it('sorts items within group by order', () => {
    const mixed: SlashItem[] = [
      { id: 'builtin:b', name: 'b', description: '', category: 'builtin', order: 2 },
      { id: 'builtin:a', name: 'a', description: '', category: 'builtin', order: 1 },
    ]
    const groups = groupSlashItems(mixed)
    expect(groups[0].items[0].name).toBe('a')
    expect(groups[0].items[1].name).toBe('b')
  })

  it('sorts project-scoped items before global-scoped within the same category', () => {
    const mixed: SlashItem[] = [
      { id: 'command:global:deploy', name: 'deploy', description: 'Deploy', category: 'command', order: 1, scope: 'global' },
      { id: 'command:project:lint', name: 'lint', description: 'Lint', category: 'command', order: 1, scope: 'project' },
    ]
    const groups = groupSlashItems(mixed)
    expect(groups[0].items[0].scope).toBe('project')
    expect(groups[0].items[1].scope).toBe('global')
  })

  it('preserves order within the same scope', () => {
    const mixed: SlashItem[] = [
      { id: 'command:project:b', name: 'b', description: '', category: 'command', order: 2, scope: 'project' },
      { id: 'command:project:a', name: 'a', description: '', category: 'command', order: 1, scope: 'project' },
      { id: 'command:global:c', name: 'c', description: '', category: 'command', order: 1, scope: 'global' },
    ]
    const groups = groupSlashItems(mixed)
    const names = groups[0].items.map((i) => i.name)
    expect(names).toEqual(['a', 'b', 'c'])
  })

  it('splits app-variant skills into Apps group at the bottom', () => {
    const mixed: SlashItem[] = [
      { id: 'builtin:help', name: 'help', description: '', category: 'builtin', order: 1 },
      { id: 'skill:global:writer', name: 'writer', description: 'General writing helper', category: 'skill', order: 1, scope: 'global' },
      {
        id: 'skill:global:evose_agent',
        name: 'evose:agent_x',
        description: 'Evose app',
        category: 'skill',
        order: 2,
        scope: 'global',
        presentation: {
          variant: 'app',
          title: 'X Analyst',
          subtitle: 'Analyze X trends',
        },
      },
    ]

    const groups = groupSlashItems(mixed)
    expect(groups.map((g) => g.category)).toEqual(['builtin', 'skill', 'apps'])
    expect(groups[1].items.map((i) => i.name)).toEqual(['writer'])
    expect(groups[2].items.map((i) => i.name)).toEqual(['evose:agent_x'])
  })
})
