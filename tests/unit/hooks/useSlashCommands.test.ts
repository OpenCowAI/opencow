// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useSlashCommands } from '../../../src/renderer/hooks/useSlashCommands'
import { ProjectScopeProvider } from '../../../src/renderer/contexts/ProjectScopeContext'
import { BUILTIN_SLASH_COMMANDS, getBuiltinSlashCommands } from '../../../src/shared/slashItems'
import type { CapabilitySnapshot, DocumentCapabilityEntry } from '../../../src/shared/types'

// ── Test Data ────────────────────────────────────────────────────────

function makeDocEntry(
  overrides: Partial<DocumentCapabilityEntry> & Pick<DocumentCapabilityEntry, 'name' | 'category'>,
): DocumentCapabilityEntry {
  return {
    kind: 'document',
    description: '',
    body: '',
    attributes: {},
    filePath: '',
    scope: 'global',
    enabled: true,
    tags: [],
    eligibility: { eligible: true, reasons: [] },
    metadata: {},
    importInfo: null,
    distributionInfo: null,
    ...overrides,
  }
}

function makeSnapshot(overrides?: Partial<CapabilitySnapshot>): CapabilitySnapshot {
  return {
    skills: [],
    agents: [],
    commands: [],
    rules: [],
    hooks: [],
    mcpServers: [],
    diagnostics: [],
    version: 1,
    timestamp: Date.now(),
    ...overrides,
  }
}

// ── Mock Setup ───────────────────────────────────────────────────────

const mockSnapshotFn = vi.fn<(projectId?: string) => Promise<CapabilitySnapshot>>()
const mockEventListeners: Array<(event: { type: string }) => void> = []

beforeEach(() => {
  vi.clearAllMocks()
  mockEventListeners.length = 0
  mockSnapshotFn.mockResolvedValue(makeSnapshot())

  Object.defineProperty(window, 'opencow', {
    value: {
      'capability:snapshot': mockSnapshotFn,
      'on:opencow:event': vi.fn((cb: (event: { type: string }) => void) => {
        mockEventListeners.push(cb)
        return () => {
          const idx = mockEventListeners.indexOf(cb)
          if (idx >= 0) mockEventListeners.splice(idx, 1)
        }
      }),
    },
    writable: true,
    configurable: true,
  })
})

// ── Wrapper ──────────────────────────────────────────────────────────

function createWrapper(opts?: { projectPath?: string; projectId?: string }) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      ProjectScopeProvider,
      { projectPath: opts?.projectPath, projectId: opts?.projectId },
      children,
    )
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useSlashCommands', () => {
  it('returns builtins while snapshot is loading', () => {
    // Make snapshot hang forever
    mockSnapshotFn.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useSlashCommands(), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    expect(result.current.allItems.length).toBe(BUILTIN_SLASH_COMMANDS.length)
    expect(result.current.allItems.every((i) => i.category === 'builtin')).toBe(true)
  })

  it('returns codex builtins for codex engine while snapshot is loading', () => {
    mockSnapshotFn.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useSlashCommands('codex'), { wrapper: createWrapper() })

    expect(result.current.loading).toBe(true)
    expect(result.current.allItems.length).toBe(getBuiltinSlashCommands('codex').length)
    expect(result.current.allItems.every((i) => i.category === 'builtin')).toBe(true)
  })

  it('includes builtins, commands, and skills after snapshot loads', async () => {
    const snapshot = makeSnapshot({
      commands: [
        makeDocEntry({ name: 'review-pr', category: 'command', description: 'Review PR' }),
      ],
      skills: [
        makeDocEntry({ name: 'commit', category: 'skill', description: 'Smart commit' }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const categories = new Set(result.current.allItems.map((i) => i.category))
    expect(categories).toContain('builtin')
    expect(categories).toContain('command')
    expect(categories).toContain('skill')
  })

  it('passes projectId from context to capability:snapshot IPC', async () => {
    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-42' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSnapshotFn).toHaveBeenCalledWith('proj-42')
  })

  it('passes undefined when no projectId is provided', async () => {
    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSnapshotFn).toHaveBeenCalledWith(undefined)
  })

  it('converts command entry to SlashItem with scope and origin', async () => {
    const snapshot = makeSnapshot({
      commands: [
        makeDocEntry({
          name: 'review-pr',
          category: 'command',
          description: 'Review PR',
          scope: 'project',
          filePath: '.opencow/commands/review-pr.md',
          attributes: { 'argument-hint': '<pr-number>' },
        }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const cmd = result.current.allItems.find((i) => i.id === 'command:project:review-pr')
    expect(cmd).toBeDefined()
    expect(cmd!.name).toBe('review-pr')
    expect(cmd!.argumentHint).toBe('<pr-number>')
    expect(cmd!.scope).toBe('project')
    expect(cmd!.origin).toBe('project')
    expect(cmd!.sourcePath).toBe('.opencow/commands/review-pr.md')
  })

  it('converts skill entry to SlashItem with scope and origin', async () => {
    const snapshot = makeSnapshot({
      skills: [
        makeDocEntry({
          name: 'commit',
          category: 'skill',
          description: 'Smart commit',
          scope: 'global',
          filePath: '~/.opencow/skills/commit/SKILL.md',
        }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const skill = result.current.allItems.find((i) => i.id === 'skill:global:commit')
    expect(skill).toBeDefined()
    expect(skill!.category).toBe('skill')
    expect(skill!.scope).toBe('global')
    expect(skill!.origin).toBe('user')
  })

  it('projects Evose skill metadata to app presentation/execution meta', async () => {
    const snapshot = makeSnapshot({
      skills: [
        makeDocEntry({
          name: 'evose:x_analyst_abc123',
          category: 'skill',
          description: 'X trend analyzer',
          metadata: {
            provider: 'evose',
            appId: 'app-x-analyst',
            appType: 'agent',
            displayName: 'X Analyst',
            avatar: 'https://example.com/avatar.png',
            gatewayTool: 'evose_run_agent',
          },
        }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const skill = result.current.allItems.find((i) => i.name === 'evose:x_analyst_abc123')
    expect(skill).toBeDefined()
    expect(skill!.presentation).toEqual({
      variant: 'app',
      title: 'X Analyst',
      subtitle: 'X trend analyzer',
      avatarUrl: 'https://example.com/avatar.png',
    })
    expect(skill!.executionMeta).toEqual({
      provider: 'evose',
      app: {
        id: 'app-x-analyst',
        type: 'agent',
        gatewayTool: 'evose_run_agent',
      },
    })
  })

  it('builtin items have no scope or origin', () => {
    // Keep loading state stable to avoid async update warnings in this sync assertion.
    mockSnapshotFn.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useSlashCommands(), { wrapper: createWrapper() })
    const builtins = result.current.allItems.filter((i) => i.category === 'builtin')
    expect(builtins.length).toBeGreaterThan(0)
    expect(builtins.every((i) => i.scope === undefined)).toBe(true)
    expect(builtins.every((i) => i.origin === undefined)).toBe(true)
  })

  it('deduplicates commands and skills with same name (command wins)', async () => {
    const snapshot = makeSnapshot({
      commands: [
        makeDocEntry({ name: 'review-pr', category: 'command', description: 'Command version' }),
      ],
      skills: [
        makeDocEntry({ name: 'review-pr', category: 'skill', description: 'Skill version' }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const matches = result.current.allItems.filter((i) => i.name === 'review-pr')
    expect(matches).toHaveLength(1)
    expect(matches[0].category).toBe('command')
  })

  it('filters out disabled entries', async () => {
    const snapshot = makeSnapshot({
      commands: [
        makeDocEntry({ name: 'active-cmd', category: 'command', enabled: true }),
        makeDocEntry({ name: 'disabled-cmd', category: 'command', enabled: false }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.allItems.some((i) => i.name === 'active-cmd')).toBe(true)
    expect(result.current.allItems.some((i) => i.name === 'disabled-cmd')).toBe(false)
  })

  it('filters out ineligible entries', async () => {
    const snapshot = makeSnapshot({
      skills: [
        makeDocEntry({ name: 'eligible-skill', category: 'skill' }),
        makeDocEntry({
          name: 'ineligible-skill',
          category: 'skill',
          eligibility: { eligible: false, reasons: ['missing dependency'] },
        }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.allItems.some((i) => i.name === 'eligible-skill')).toBe(true)
    expect(result.current.allItems.some((i) => i.name === 'ineligible-skill')).toBe(false)
  })

  it('sorts project-scope entries before global-scope entries', async () => {
    const snapshot = makeSnapshot({
      commands: [
        makeDocEntry({ name: 'global-cmd', category: 'command', scope: 'global' }),
        makeDocEntry({ name: 'project-cmd', category: 'command', scope: 'project' }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const commands = result.current.allItems.filter((i) => i.category === 'command')
    expect(commands[0].name).toBe('project-cmd')
    expect(commands[1].name).toBe('global-cmd')
  })

  it('derives origin from importInfo.sourceOrigin', async () => {
    const snapshot = makeSnapshot({
      skills: [
        makeDocEntry({
          name: 'marketplace-skill',
          category: 'skill',
          scope: 'global',
          importInfo: {
            sourcePath: '/tmp/skill.tar.gz',
            sourceOrigin: 'marketplace',
            sourceHash: null,
            importedAt: Date.now(),
          },
        }),
      ],
    })
    mockSnapshotFn.mockResolvedValue(snapshot)

    const { result } = renderHook(() => useSlashCommands(), {
      wrapper: createWrapper({ projectId: 'proj-1' }),
    })

    await waitFor(() => expect(result.current.loading).toBe(false))

    const skill = result.current.allItems.find((i) => i.name === 'marketplace-skill')
    expect(skill!.origin).toBe('marketplace')
  })
})
